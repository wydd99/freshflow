// Update deployed cloud function code (zip base64 via SCF UpdateFunctionCode)
// 用法：node update-fn.js [FN] [SRC]   （缺省更新 useradmin；例：node update-fn.js platform D:/FreshFlow/cloudfunctions/platform）
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const ENV = 'freshflow-ENV_ID'
const FN = process.argv[2] || 'useradmin'
const SRC = process.argv[3] || `D:/FreshFlow/cloudfunctions/${FN}`
const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', '.cloudbase', 'auth.json'), 'utf8')).credential

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function makeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(f.data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, f.data)
    central.push({ nameBuf, crc, size: f.data.length, offset })
    offset += local.length + nameBuf.length + f.data.length
  }
  const centralStart = offset
  for (const c of central) {
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(c.crc, 16)
    cd.writeUInt32LE(c.size, 20)
    cd.writeUInt32LE(c.size, 24)
    cd.writeUInt16LE(c.nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(c.offset, 42)
    chunks.push(cd, c.nameBuf)
    offset += cd.length + c.nameBuf.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20)
  chunks.push(end)
  return Buffer.concat(chunks)
}

function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest() }

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

async function main() {
  const zipBuf = makeZip([
    { name: 'index.js', data: fs.readFileSync(path.join(SRC, 'index.js')) },
    { name: 'package.json', data: fs.readFileSync(path.join(SRC, 'package.json')) },
  ])
  const upd = await scfRequest('UpdateFunctionCode', {
    FunctionName: FN, Namespace: ENV, ZipFile: zipBuf.toString('base64'),
  })
  console.log('UpdateFunctionCode:', JSON.stringify(upd).slice(0, 300))
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 4000))
    const st = await scfRequest('GetFunction', { FunctionName: FN, Namespace: ENV })
    const status = st.Response && st.Response.Status
    console.log('poll', i, status)
    if (status === 'Active') { console.log('UPDATE DONE'); return }
    if (st.Response.Error) { console.log(JSON.stringify(st.Response.Error)); return }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
