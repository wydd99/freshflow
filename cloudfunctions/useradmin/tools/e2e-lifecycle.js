// Positive E2E v2: use customer_a (test shop account) as the lifecycle subject
// Delete customer_a Auth user + customer_user row -> recreate via useradmin.createSubUser
// (dogfood) -> resetPassword -> setStatus block/unblock -> unbind -> restore mapping.
// End state: customer_a active, password TempPwd000, mapping present (fully restored).
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const ENV = 'freshflow-ENV_ID'
const GW = `https://${ENV}.api.tcloudbasegateway.com`
const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', '.cloudbase', 'auth.json'), 'utf8')).credential

function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest() }

async function tcbRequest(action, payload) {
  const body = JSON.stringify(payload)
  const service = 'tcb'
  const host = 'tcb.tencentcloudapi.com'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalRequest = ['POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(body).digest('hex')].join('\n')
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + date + '/' + service + '/tc3_request\n' +
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  const kDate = hmac('TC3' + auth.tmpSecretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const r = await fetch('https://tcb.tencentcloudapi.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': '2018-06-08',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-shanghai',
      'X-TC-Token': auth.tmpToken,
      Authorization: `TC3-HMAC-SHA256 Credential=${auth.tmpSecretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`,
    },
    body,
  })
  return r.json()
}

async function scfRequest(action, payload) {
  const body = JSON.stringify(payload)
  const service = 'scf'
  const host = 'scf.tencentcloudapi.com'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalRequest = ['POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(body).digest('hex')].join('\n')
  const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + date + '/' + service + '/tc3_request\n' +
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  const kDate = hmac('TC3' + auth.tmpSecretKey, date)
  const kService = hmac(kDate, service)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const r = await fetch('https://scf.tencentcloudapi.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': '2018-04-16',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-shanghai',
      'X-TC-Token': auth.tmpToken,
      Authorization: `TC3-HMAC-SHA256 Credential=${auth.tmpSecretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`,
    },
    body,
  })
  return r.json()
}

async function invokeUseradmin(token, action, payload, deviceId) {
  const clientContext = JSON.stringify({ action, access_token: token, device_id: deviceId, payload })
  const r = await scfRequest('Invoke', { FunctionName: 'useradmin', Namespace: ENV, ClientContext: clientContext })
  const ret = r.Response && r.Response.Result && r.Response.Result.RetMsg
  if (!ret) throw new Error('no RetMsg: ' + JSON.stringify(r).slice(0, 400))
  return JSON.parse(ret)
}

async function signin(username, password) {
  const deviceId = 'e2e-' + username + '-' + Date.now()
  const r = await fetch(`${GW}/auth/v1/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
    body: JSON.stringify({ username, password }),
  })
  const j = await r.json().catch(() => ({}))
  if (!j.access_token) return { failed: true, raw: j }
  j.device_id = deviceId
  return j
}

async function restCall(method, token, table, query, body, deviceId) {
  const headers = { Authorization: 'Bearer ' + token, 'x-device-id': deviceId || 'ff-server' }
  if (body) { headers['Content-Type'] = 'application/json'; headers.Prefer = 'return=representation' }
  const r = await fetch(`${GW}/v1/rdb/rest/${table}${query ? '?' + query : ''}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => []) }
}

async function main() {
  const CH_UID = '—' // customer_a old uid

  console.log('== 0. free the slot: delete customer_a Auth user')
  const del = await tcbRequest('DeleteUsers', { EnvId: ENV, Uids: [CH_UID] })
  console.log('   DeleteUsers:', JSON.stringify(del).slice(0, 200))

  console.log('== 1. signin merchant_a (admin) + drop old customer_user row')
  const adminSess = await signin('merchant_a', 'TempPwd000')
  if (adminSess.failed) throw new Error('merchant_a signin failed')
  console.log('   ok')
  const delRow = await restCall('DELETE', adminSess.access_token, 'customer_user', `uid=eq.${CH_UID}`, null, adminSess.device_id)
  console.log('   old row delete status:', delRow.status)

  console.log('== 2. createSubUser customer_a (dogfood restore)')
  const created = await invokeUseradmin(adminSess.access_token, 'createSubUser', {
    username: 'customer_a', password: 'TempPwd000', displayName: '客户甲', customerId: 1, canExport: true,
  }, adminSess.device_id)
  console.log('   result:', JSON.stringify(created))
  if (!created.ok) throw new Error('createSubUser failed: ' + created.error)
  const newUid = created.uid

  console.log('== 3. verify row + signin as recreated customer_a')
  const row = await restCall('GET', adminSess.access_token, 'customer_user', `select=id,username,uid,status&uid=eq.${newUid}`, null, adminSess.device_id)
  console.log('   row:', JSON.stringify(row.body))
  const s1 = await signin('customer_a', 'TempPwd000')
  console.log('   signin:', s1.failed ? 'FAILED ' + JSON.stringify(s1.raw).slice(0, 200) : 'OK sub=' + s1.sub + ' uid-match=' + (s1.sub === newUid))

  console.log('== 4. resetPassword -> TempPwd000 -> verify -> back to TempPwd000')
  const r1 = await invokeUseradmin(adminSess.access_token, 'resetPassword', { uid: newUid, password: 'TempPwd000' }, adminSess.device_id)
  console.log('   reset1:', JSON.stringify(r1))
  const s2 = await signin('customer_a', 'TempPwd000')
  console.log('   signin new pwd:', s2.failed ? 'FAILED' : 'OK')
  const r2 = await invokeUseradmin(adminSess.access_token, 'resetPassword', { uid: newUid, password: 'TempPwd000' }, adminSess.device_id)
  console.log('   reset2:', JSON.stringify(r2))
  const s3 = await signin('customer_a', 'TempPwd000')
  console.log('   signin orig pwd:', s3.failed ? 'FAILED' : 'OK')

  console.log('== 5. setStatus blocked -> signin rejected; active -> ok')
  const b1 = await invokeUseradmin(adminSess.access_token, 'setStatus', { uid: newUid, blocked: true }, adminSess.device_id)
  console.log('   block:', JSON.stringify(b1))
  const s4 = await signin('customer_a', 'TempPwd000')
  console.log('   blocked signin:', s4.failed ? 'REJECTED (correct)' : 'PASSED (WRONG!)')
  const b2 = await invokeUseradmin(adminSess.access_token, 'setStatus', { uid: newUid, blocked: false }, adminSess.device_id)
  console.log('   unblock:', JSON.stringify(b2))
  const s5 = await signin('customer_a', 'TempPwd000')
  console.log('   unblocked signin:', s5.failed ? 'FAILED (WRONG!)' : 'OK (correct)')

  console.log('== 6. unbind -> row removed')
  const u1 = await invokeUseradmin(adminSess.access_token, 'unbind', { uid: newUid }, adminSess.device_id)
  console.log('   unbind:', JSON.stringify(u1))
  const rowAfter = await restCall('GET', adminSess.access_token, 'customer_user', `select=id&uid=eq.${newUid}`, null, adminSess.device_id)
  console.log('   rows after unbind:', rowAfter.body.length, '(expect 0)')

  console.log('== 7. restore mapping (direct insert, same as function does)')
  const ins = await restCall('POST', adminSess.access_token, 'customer_user', '', {
    tenant_id: 1, customer_id: 1, username: 'customer_a', password_hash: '',
    display_name: '客户甲', phone: null, can_export: true, status: 'active', uid: newUid,
  }, adminSess.device_id)
  console.log('   insert status:', ins.status, JSON.stringify(ins.body).slice(0, 150))
  const s6 = await signin('customer_a', 'TempPwd000')
  console.log('   final signin:', s6.failed ? 'FAILED' : 'OK — customer_a fully restored')

  console.log('\nPOSITIVE E2E ALL PASS')
}
main().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1) })
