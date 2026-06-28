/**
 * inject-to-html.js — 将飞书拉取的数据注入到 main.html
 *
 * 使用方式：
 *   node inject-to-html.js
 *
 * 功能：
 *   1. 读取 data/feishu-data.json
 *   2. 更新 main.html 中的成员寄语（voiceQuotes 数组）
 *   3. 更新日常照片墙
 *   4. 输出 main.html（覆盖原文件）
 *
 * 要求：先运行 node fetch-feishu.js 拉取最新数据
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'feishu-data.json');
const HTML_FILE = path.join(__dirname, 'main.html');

// ===== 生成 voiceQuotes JS 数组字符串 =====
function generateVoiceQuotesJS(quotes) {
  const items = quotes
    .filter((q) => q.quote && q.name) // 必须有寄语和姓名
    .map((q) => {
      const dept = q.department || '三院科协';
      const displayName = q.studentId ? `${q.name}(${q.studentId.slice(-4)})` : q.name;
      return `  { q:'${escapeJS(q.quote)}', a:'${escapeJS(displayName)}', d:'${escapeJS(dept)}' }`;
    });

  if (items.length === 0) {
    // 没有寄语数据时保留默认示例
    return `const voiceQuotes = [
  { q:'期待你的寄语…', a:'你', d:'三院科协' },
];`;
  }

  return `const voiceQuotes = [\n${items.join(',\n')}\n];`;
}

// ===== 生成日常照片 HTML 字符串 =====
function generateDailyPhotosHTML(quotes) {
  const photos = [];
  for (const q of quotes) {
    if (q.photos && q.photos.length > 0) {
      for (const p of q.photos) {
        const rot = ((Math.random() * 3) - 1.5).toFixed(1);
        const spanClass = Math.random() > 0.5 ? 'wide' : '';
        photos.push(`    <div class="ed-cell${spanClass ? ' ' + spanClass : ''}" style="transform:rotate(${rot}deg)"><img src="${escapeHTML(p)}" alt="${escapeHTML(q.name)}"></div>`);
      }
    }
  }

  if (photos.length === 0) return null;
  return photos.join('\n');
}

// ===== JS 字符串转义 =====
function escapeJS(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function escapeHTML(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== 主力函数 =====
function main() {
  console.log('=== 注入飞书数据到 HTML ===\n');

  // 1. 读取数据
  if (!fs.existsSync(DATA_FILE)) {
    console.error('✗ 未找到数据文件，请先运行: node fetch-feishu.js');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log(`✓ 读取 ${data.total} 条寄语, ${new Date(data.fetchedAt).toLocaleString()} 拉取`);

  // 2. 读取 HTML
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`✗ 未找到 ${HTML_FILE}`);
    process.exit(1);
  }
  let html = fs.readFileSync(HTML_FILE, 'utf-8');
  const originalHtml = html;
  let changes = [];

  // 3. 替换 voiceQuotes 数组
  const voiceRegex = /const voiceQuotes\s*=\s*\[[\s\S]*?\];/;
  if (voiceRegex.test(html)) {
    const newQuotes = generateVoiceQuotesJS(data.quotes);
    html = html.replace(voiceRegex, newQuotes);
    changes.push(`✓ voiceQuotes 数组 → ${data.quotes.filter(q => q.quote && q.name).length} 条`);
  } else {
    console.warn('⚠ 未找到 voiceQuotes 数组，跳过寄语注入');
  }

  // 4. 替换日常照片墙（如果有数据）
  const dailyPhotos = generateDailyPhotosHTML(data.quotes);
  if (dailyPhotos) {
    // 找 event-daily 中的 ed-wall 区域
    const dailyWallRegex = /(<section class="event-detail" id="event-daily">[\s\S]*?<div class="ed-wall">)([\s\S]*?)(<\/div>[\s\S]*?<\/section>)/;
    const match = html.match(dailyWallRegex);
    if (match) {
      html = html.replace(
        dailyWallRegex,
        `$1\n${dailyPhotos}\n$3`
      );
      changes.push(`✓ 日常照片墙 → ${data.quotes.filter(q => q.photos && q.photos.length > 0).length} 人上传`);
    }
  }

  // 5. 写回 HTML
  if (html === originalHtml) {
    console.log('\n⚠ HTML 未发生变化（可能已有数据或正则不匹配）');
  } else {
    fs.writeFileSync(HTML_FILE, html, 'utf-8');
    console.log(`\n✓ 已更新: main.html`);
  }

  console.log('\n完成！现在可以提交 Git 并部署到 Vercel。');
}

main();
