// Test script to verify HGR row interleaving calculation
// Expected: rows 0-191 should map to offsets 0x0000-0x1FFF without gaps

function rowToHgrOffset(row) {
    const low = ((row & 0xc0) >> 1) | ((row & 0xc0) >> 3) | ((row & 0x08) << 4);
    const high = ((row & 0x07) << 2) | ((row & 0x30) >> 4);
    return (high << 8) | low;
}

// Test all 192 rows
const offsets = [];
for (let row = 0; row < 192; row++) {
    const offset = rowToHgrOffset(row);
    offsets.push({ row, offset: offset.toString(16).padStart(4, '0') });
}

// Check for duplicates
const offsetSet = new Set(offsets.map(o => o.offset));
console.log(`Unique offsets: ${offsetSet.size} (expected: 192)`);

// Check coverage
const minOffset = Math.min(...offsets.map(o => parseInt(o.offset, 16)));
const maxOffset = Math.max(...offsets.map(o => parseInt(o.offset, 16)));
console.log(`Offset range: 0x${minOffset.toString(16)} - 0x${maxOffset.toString(16)}`);
console.log(`Expected: 0x0000 - 0x1fc0 (40 bytes per row * 192 rows = 7680 = 0x1e00)`);

// Show first 20 and last 20 rows
console.log('\nFirst 20 rows:');
for (let i = 0; i < 20; i++) {
    console.log(`  Row ${i.toString().padStart(3)}: offset 0x${offsets[i].offset}`);
}

console.log('\nLast 20 rows:');
for (let i = 172; i < 192; i++) {
    console.log(`  Row ${i.toString().padStart(3)}: offset 0x${offsets[i].offset}`);
}

// Check if offsets are spaced 40 bytes apart (0x28)
console.log('\nChecking if sequential rows are 40 bytes apart:');
let problems = [];
for (let i = 0; i < 191; i++) {
    const offset1 = parseInt(offsets[i].offset, 16);
    const offset2 = parseInt(offsets[i+1].offset, 16);
    const diff = offset2 - offset1;
    if (diff !== 0x28 && diff !== -0x1fd8 && diff !== 0x400 && diff !== -0x50) {
        problems.push(`Row ${i} -> ${i+1}: offset jump 0x${diff.toString(16)}`);
    }
}

if (problems.length > 0) {
    console.log('Problems found:');
    problems.slice(0, 10).forEach(p => console.log(`  ${p}`));
} else {
    console.log('Interleaving pattern looks correct');
}
