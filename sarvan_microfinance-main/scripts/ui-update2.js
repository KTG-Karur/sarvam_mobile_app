const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/dashboard/reports/demand/demand-sheet/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Fix Grand total
content = content.replace(/<TableCell className="text-right px-2 py-2 text-xs  border-slate-300 uppercase">/g, 
  '<TableCell className="text-right px-4 py-5 text-sm border-slate-300 uppercase font-black text-slate-800">');
content = content.replace(/<TableCell className="text-center py-2 text-xs  border-slate-300">/g, 
  '<TableCell className="text-center py-5 text-sm border-slate-300 font-bold text-slate-900">');
content = content.replace(/<TableCell className="text-right py-2 text-xs  border-slate-300">/g, 
  '<TableCell className="text-right py-5 text-sm border-slate-300 font-bold text-slate-900">');
content = content.replace(/<TableCell className="text-right py-2 text-xs  border-slate-300 text-green-700">/g, 
  '<TableCell className="text-right py-5 text-sm border-slate-300 font-bold text-green-700">');

// Update Clientwise table view to match Centerwise visually 
content = content.replace(
  /<div className="rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">\s*<Table>\s*<TableHeader>\s*<TableRow className="bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700">/g,
  `<div className="rounded-md border-2 border-slate-200 shadow-lg p-2 bg-white/50 backdrop-blur-sm overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700">`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('UI updated 2 successfully!');
