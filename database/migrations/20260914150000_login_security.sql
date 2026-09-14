-- FreshFlow · login_security：登录安全（新设备手机验证码验证 + 登录审计）
-- 2026-09-14 · 需求：新设备首次登录需手机验证码验证，验证过的设备进白名单后免验
-- 执行通道：tcb db execute（applyMigration 静默失败是本项目历史坑；本文件为事实源）
-- 配套：云函数 authgate（发码/校验/写白名单，用环境 API Key 以 service_role 写库）
--       customer_user.phone 已有；admin_user.phone 本次补齐；前端各端登录后调 /authgate

-- 1) 补齐手机号列
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2) 登录设备表（设备白名单）
CREATE TABLE IF NOT EXISTS login_device (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id      BIGINT NOT NULL,
    actor_type     TEXT NOT NULL,                  -- admin / customer
    actor_id       BIGINT NOT NULL,                -- admin_user.id / customer_user.id
    actor_uid      TEXT NOT NULL,                  -- CloudBase Auth uid（self 读取策略按它匹配）
    username       TEXT NOT NULL,
    device_id      TEXT NOT NULL,
    verified       BOOLEAN NOT NULL DEFAULT false, -- true = 已通过手机验证（白名单）
    verified_at    TIMESTAMPTZ,
    first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    login_count    INT NOT NULL DEFAULT 1,
    last_ip        TEXT,
    pending_vid    TEXT,                           -- 待验证的 verification_id（发码后暂存）
    pending_vid_at TIMESTAMPTZ,
    pending_fail   INT NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, actor_type, actor_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_login_device_actor ON login_device (tenant_id, actor_type, actor_id);

-- 3) 登录审计表
CREATE TABLE IF NOT EXISTS login_audit (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT,
    actor_type TEXT,
    actor_id   BIGINT,
    actor_uid  TEXT,
    username   TEXT,
    device_id  TEXT,
    ip         TEXT,
    event      TEXT NOT NULL,                      -- new_device/login/verify_sent/verify_ok/verify_fail
    detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_audit_actor ON login_audit (tenant_id, actor_type, actor_id, created_at DESC);

-- 4) 授权与 RLS：authenticated 只读（自己读自己、商家读本租户）；写仅 service_role（云函数 API Key）
ALTER TABLE login_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_audit  ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON login_device TO authenticated;
GRANT SELECT ON login_audit  TO authenticated;

DROP POLICY IF EXISTS p_login_device_self ON login_device;
CREATE POLICY p_login_device_self ON login_device FOR SELECT
  USING (actor_uid = auth.uid());
DROP POLICY IF EXISTS p_login_device_staff ON login_device;
CREATE POLICY p_login_device_staff ON login_device FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = login_device.tenant_id));

DROP POLICY IF EXISTS p_login_audit_self ON login_audit;
CREATE POLICY p_login_audit_self ON login_audit FOR SELECT
  USING (actor_uid = auth.uid());
DROP POLICY IF EXISTS p_login_audit_staff ON login_audit;
CREATE POLICY p_login_audit_staff ON login_audit FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = login_audit.tenant_id));
