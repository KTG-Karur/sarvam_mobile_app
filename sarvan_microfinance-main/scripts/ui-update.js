const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/dashboard/reports/demand/demand-sheet/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update PDF styles - Centerwise
content = content.replace(
  /theme: "grid",\s*headStyles: \{\s*fillColor: \[37, 99, 235\],\s*textColor: 255,\s*fontSize: 8,\s*fontStyle: "bold",\s*\},/g,
  `theme: "striped",
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontSize: 9,
          fontStyle: "bold",
          halign: "center",
          cellPadding: 4,
        },`
);
content = content.replace(
  /bodyStyles: \{ fontSize: 7, textColor: \[0, 0, 0\] \},/g,
  `bodyStyles: { fontSize: 8, textColor: [30, 41, 59], cellPadding: 3 },`
);

// 2. Update PDF styles - Clientwise
content = content.replace(
  /theme: "grid",\s*headStyles: \{\s*fillColor: \[37, 99, 235\],\s*textColor: 255,\s*fontSize: 8,\s*fontStyle: "bold",\s*\},/g,
  `theme: "striped",
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontSize: 9,
          fontStyle: "bold",
          halign: "center",
          cellPadding: 4,
        },`
);


// 3. Update HTML Headers & Layout
content = content.replace(/border border-slate-300 dark:border-slate-700/g, 'border-2 border-slate-200 shadow-lg p-2 bg-white/50 backdrop-blur-sm');
content = content.replace(/border-r /g, ' '); // remove vertical borders from table cells
content = content.replace(/py-1 text-xs/g, 'py-4 text-sm');
content = content.replace(/py-2 h-auto text-xs/g, 'py-5 h-auto text-sm tracking-wide text-slate-600');
content = content.replace(/text-xs border-r/g, 'text-sm');
content = content.replace(/h-8/g, 'h-14'); // Make rows taller

// Make the K3 Banner area much cleaner
content = content.replace(
  /<div className="flex flex-col items-center justify-center relative mb-6 border-b pb-4">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g,
  `<div className="flex items-center justify-between border-b-2 border-slate-200 pb-6 mb-6">
                    <div className="flex items-center gap-5">
                      <div className="relative h-20 w-20 overflow-hidden rounded-2xl bg-white shadow-md border border-slate-100 p-2 flex-shrink-0">
                        <Image src="/Sarvam_01.png" alt="Logo" fill className="object-contain" unoptimized />
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold uppercase tracking-widest text-slate-900 bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-700">
                          {companyNameCaps}
                        </h2>
                        <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mt-1">
                          Enterprise Microfinance System
                        </p>
                      </div>
                    </div>
                  </div>`
);

// Beautify Branch and Meeting Info blocks
content = content.replace(
  /<div className="grid grid-cols-2 gap-y-2 text-sm px-4">[\s\S]*?<\/div>\s*<\/div>/g,
  `<div className="grid grid-cols-4 gap-6 bg-slate-50/80 rounded-2xl p-6 border border-slate-200 shadow-sm mb-8">
                    <div className="flex flex-col border-r border-slate-200 pr-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Branch</span>
                      <span className="text-base font-bold text-slate-800 uppercase">{branchLabel}</span>
                    </div>
                    <div className="flex flex-col border-r border-slate-200 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Day</span>
                      <span className="text-base font-bold text-blue-700 uppercase">{dayName}</span>
                    </div>
                    <div className="flex flex-col border-r border-slate-200 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">FDO Name</span>
                      <span className="text-base font-bold text-slate-800 uppercase">{fdoName}</span>
                    </div>
                    <div className="flex flex-col pl-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Date</span>
                      <span className="text-base font-bold text-blue-700">{formattedDate}</span>
                    </div>
                  </div>`
);

// Grand total styling
content = content.replace(/<TableRow className="font-bold bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-400">/g, 
  '<TableRow className="font-extrabold bg-blue-50/50 border-t-4 border-slate-300 text-slate-900">');

// Write back
fs.writeFileSync(filePath, content, 'utf8');
console.log('UI updated successfully!');
