const fs = require('fs');
// InventoryKanban: remove non-ASCII between </span> and {item.binLocation}
let s = fs.readFileSync('src/InventoryKanban.tsx', 'utf8');
s = s.replace(/location_on<\/span>[^}]*\{item\.binLocation\}/, 'location_on</span>{item.binLocation}');
fs.writeFileSync('src/InventoryKanban.tsx', s);
// JobDetail: replace corrupted link prefix with icon
s = fs.readFileSync('src/JobDetail.tsx', 'utf8');
s = s.replace(/>\s*[^\w\s{].*?displayName\.substring/g, '><span className="material-symbols-outlined text-sm align-middle">link</span> {displayName.substring');
fs.writeFileSync('src/JobDetail.tsx', s);
// AdminCreateJob: replace any corrupted chars before validationErrors with warning icon
s = fs.readFileSync('src/AdminCreateJob.tsx', 'utf8');
s = s.replace(/<p className="text-red-400 text-xs mt-1">[^<]*\{validationErrors\.jobCode\}/g, '<p className="text-red-400 text-xs mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-sm">warning</span>{validationErrors.jobCode}');
s = s.replace(/<p className="text-red-400 text-xs mt-1">[^<]*\{validationErrors\.name\}/g, '<p className="text-red-400 text-xs mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-sm">warning</span>{validationErrors.name}');
fs.writeFileSync('src/AdminCreateJob.tsx', s);
console.log('Done');
