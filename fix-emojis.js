const fs = require('fs');
const path = require('path');

const files = [
  'src/pocketbase.ts',
  'src/JobDetail.tsx',
  'src/JobList.tsx',
  'src/TrelloImport.tsx'
];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Fix common emoji artifacts
  content = content.replace(/ðŸ"§/g, '🔧');
  content = content.replace(/ðŸ"¤/g, '📤');
  content = content.replace(/ðŸ"‹/g, '📋');
  content = content.replace(/ðŸ"„/g, '📄');
  content = content.replace(/ðŸ"¥/g, '📥');
  content = content.replace(/ðŸ"¦/g, '📦');
  content = content.replace(/âŒ/g, '❌');
  content = content.replace(/ðŸ"Š/g, '⚠️');
  content = content.replace(/ðŸ"/g, '🔐');
  content = content.replace(/ðŸ"Ž/g, '📎');
  content = content.replace(/â³/g, '⏳');
  content = content.replace(/ðŸ"â€™/g, '🔒');
  content = content.replace(/âš ï¸/g, '⚠️');
  content = content.replace(/Ã¢Å¡Â Ã¯Â¸Â/g, '⚠️');
  content = content.replace(/ÃƒÂ°Ã…Â¸Ã¢â‚¬Â"Ã¢â‚¬â€"/g, '🔗');
  content = content.replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢/g, '•');
  content = content.replace(/Ã°Å¸â€"Â¥/g, '🔥');
  content = content.replace(/Ã¢â‚¬Â¢/g, '•');
  content = content.replace(/Ã¢Å"â€¦/g, '✅');
  content = content.replace(/Ã¢ÂŒÅ'/g, '❌');
  content = content.replace(/Ã°Å¸â€"Â¢/g, '🔢');
  content = content.replace(/Ã°Å¸â€œÂ/g, '📝');
  content = content.replace(/Ã°Å¸â€"Â/g, '📋');
  content = content.replace(/Ã°Å¸â€"â€"/g, '🔗');
  content = content.replace(/Ã¢Å¡Â Ã¯Â¸Â/g, '⚠️');
  content = content.replace(/Ã°Å¸â€œÂ¦/g, '📦');
  content = content.replace(/Ã°Å¸â€œâ€¹/g, '📥');
  content = content.replace(/Ã¢â€"Â¼/g, '▼');
  content = content.replace(/Ã¢â€"Â¶/g, '▶');
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed: ${file}`);
  } else {
    console.log(`No changes needed: ${file}`);
  }
});

console.log('Done!');
