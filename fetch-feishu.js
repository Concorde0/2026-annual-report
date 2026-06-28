/**
 * fetch-feishu.js — 从飞书多维表格拉取成员寄语 + 图片
 *
 * 使用方式：
 *   node fetch-feishu.js
 *
 * 流程：
 *   1. 读取飞书多维表格（学号姓名 / 部门 / 寄语内容 / 日常图片）
 *   2. 下载所有照片到 photos/feishu/ 文件夹
 *   3. 生成 data/feishu-data.json（供 HTML 注入使用）
 *
 * 部署前执行一次，生成的 data/feishu-data.json 提交到 Git。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ===== 配置 =====
const CONFIG = {
  appId: 'cli_aa980d83f1b85cbd',
  appSecret: '59FaZwLYKbACU4l9GphJMgH1XvFip7ko',
  appToken: 'Xb7ibYlWTanTTzsBlhMcXMhinPg',
  tableId: 'tblkKW9XBKDB7jFD',
  dataDir: path.join(__dirname, 'data'),
  photoDir: path.join(__dirname, 'photos', 'feishu'),
};

// 字段名映射（如果改过表头字段名，同步改这里）
const FIELD_NAMES = {
  studentName: '学号姓名',
  department: '文本 3',
  quote: '寄语内容',
  photo: '日常图片',
};

// ===== HTTP 请求工具 =====
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(raw.toString()));
          } catch {
            resolve(raw);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.toString().slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ===== 1. 获取 Access Token =====
async function getAccessToken() {
  const body = JSON.stringify({
    app_id: CONFIG.appId,
    app_secret: CONFIG.appSecret,
  });
  const res = await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (res.code !== 0) throw new Error(`Auth failed: ${res.msg}`);
  console.log(`✓ 获取 Token 成功，有效期 ${res.expire}s`);
  return res.tenant_access_token;
}

// ===== 2. 获取所有记录（含分页） =====
async function fetchAllRecords(token) {
  const records = [];
  let pageToken = '';
  const base = `https://open.feishu.cn/open-apis/bitable/v1/apps/${CONFIG.appToken}/tables/${CONFIG.tableId}/records`;

  while (true) {
    const url = base + (pageToken ? `?page_token=${pageToken}&page_size=500` : '?page_size=500');
    const res = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.code !== 0) throw new Error(`Fetch records failed: ${res.msg}`);

    for (const item of res.data.items) {
      records.push(item);
    }

    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }

  console.log(`✓ 获取记录 ${records.length} 条`);
  return records;
}

// ===== 3. 下载附件 =====
async function downloadAttachment(token, fileToken, fileName) {
  const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;
  const savePath = path.join(CONFIG.photoDir, fileName);

  // 已存在则跳过
  if (fs.existsSync(savePath)) {
    console.log(`  ↺ 跳过（已存在）: ${fileName}`);
    return savePath;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';

        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 检查是否是 JSON 错误响应
          if (contentType.includes('json')) {
            try {
              const err = JSON.parse(raw.toString());
              reject(new Error(`Download failed: ${err.msg}`));
              return;
            } catch {}
          }
          fs.writeFileSync(savePath, raw);
          console.log(`  ✓ 下载: ${fileName} (${(raw.length / 1024).toFixed(0)}KB)`);
          resolve(savePath);
        } else {
          reject(new Error(`Download HTTP ${res.statusCode}: ${raw.toString().slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ===== 4. 从字段值中提取附件 file_token =====
function extractFileTokens(fieldValue) {
  // 附件字段可能是 null/空数组/对象数组
  if (!fieldValue) return [];
  if (Array.isArray(fieldValue)) {
    return fieldValue
      .filter((item) => item && item.file_token)
      .map((item) => ({
        fileToken: item.file_token,
        name: item.name || `${item.file_token}.jpg`,
      }));
  }
  return [];
}

// ===== 5. 选择部门选项的展示名 =====
function getDepartmentLabel(fieldValue) {
  if (!fieldValue) return null;
  // SingleSelect 返回 { "text": "软件部" } 或字符串
  if (typeof fieldValue === 'string') return fieldValue;
  if (fieldValue.text) return fieldValue.text;
  return null;
}

// ===== Main =====
async function main() {
  console.log('=== 飞书多维表格 → 本地数据拉取 ===\n');

  // 确保输出目录存在
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  fs.mkdirSync(CONFIG.photoDir, { recursive: true });

  try {
    // 1. 获取 Token
    const token = await getAccessToken();

    // 2. 拉取所有记录
    const records = await fetchAllRecords(token);

    // 3. 解析数据
    const quotes = [];
    let photoCount = 0;

    for (const rec of records) {
      const fields = rec.fields || {};
      const studentName = fields[FIELD_NAMES.studentName] || '';
      const department = getDepartmentLabel(fields[FIELD_NAMES.department]);
      const quote = fields[FIELD_NAMES.quote] || '';

      // 跳过空行
      if (!studentName && !quote) continue;

      // 解析学号和姓名（"20230001张三" 或 "张三"）
      let stuId = '';
      let name = studentName;
      const idMatch = studentName.match(/^(\d{8,12})(.+)/);
      if (idMatch) {
        stuId = idMatch[1];
        name = idMatch[2];
      }

      // 处理图片附件
      const photoFiles = extractFileTokens(fields[FIELD_NAMES.photo]);
      const downloadedPhotos = [];
      for (const pf of photoFiles) {
        try {
          const savePath = await downloadAttachment(token, pf.fileToken, pf.name);
          downloadedPhotos.push(`photos/feishu/${pf.name}`);
          photoCount++;
        } catch (err) {
          console.error(`  ✗ 下载失败 ${pf.name}: ${err.message}`);
        }
      }

      quotes.push({
        name: name || '匿名',
        studentId: stuId || '',
        department: department || '',
        quote: quote || '',
        photos: downloadedPhotos,
      });
    }

    // 4. 写入 JSON
    const output = {
      fetchedAt: new Date().toISOString(),
      total: quotes.length,
      quotes,
    };
    const jsonPath = path.join(CONFIG.dataDir, 'feishu-data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`\n=== 完成 ===`);
    console.log(`寄语: ${quotes.length} 条`);
    console.log(`照片: ${photoCount} 张 → photos/feishu/`);
    console.log(`数据: ${jsonPath}`);
    console.log(`\n提示：运行 node inject-to-html.js 将数据注入到 main.html`);

  } catch (err) {
    console.error('\n✗ 出错:', err.message);
    process.exit(1);
  }
}

main();
