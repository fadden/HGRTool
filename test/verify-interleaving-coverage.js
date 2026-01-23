// Test to verify that the interleaving formula covers all rows without gaps

function rowToHgrOffset(row) {
    const low = ((row & 0xc0) >> 1) | ((row & 0xc0) >> 3) | ((row & 0x08) << 4);
    const high = ((row & 0x07) << 2) | ((row & 0x30) >> 4);
    return (high << 8) | low;
}

// Simulate the import process
const linearData = new Uint8Array(7680); // 192 rows * 40 bytes
const interleavedData = new Uint8Array(8192); // Full HGR page size (FIXED!)

// Fill linear data with row numbers (for testing)
for (let row = 0; row < 192; row++) {
    const linearOffset = row * 40;
    // Fill each row with its row number (for easy identification)
    for (let col = 0; col < 40; col++) {
        linearData[linearOffset + col] = row + 1; // +1 to avoid 0
    }
}

// Do the interleaving (same as importImageFile)
for (let row = 0; row < 192; row++) {
    const linearOffset = row * 40;
    const interleavedOffset = rowToHgrOffset(row);
    for (let col = 0; col < 40; col++) {
        interleavedData[interleavedOffset + col] = linearData[linearOffset + col];
    }
}

// Now verify: read back using the same formula and check all rows are present
const foundRows = new Set();
const emptyRows = [];

for (let row = 0; row < 192; row++) {
    const offset = rowToHgrOffset(row);

    // Check if this row has data
    let hasData = false;
    let uniqueValue = null;

    for (let col = 0; col < 40; col++) {
        const byte = interleavedData[offset + col];
        if (byte !== 0) {
            hasData = true;
            if (uniqueValue === null) {
                uniqueValue = byte;
            }
        }
    }

    if (!hasData) {
        emptyRows.push(row);
    } else if (uniqueValue !== null) {
        foundRows.add(uniqueValue - 1); // -1 because we added 1 earlier
    }
}

console.log('=== Interleaving Coverage Test ===');
console.log(`Total rows: 192`);
console.log(`Rows with data: ${foundRows.size}`);
console.log(`Empty rows: ${emptyRows.length}`);

if (emptyRows.length > 0) {
    console.log('\nEmpty rows:');
    emptyRows.forEach(row => console.log(`  Row ${row}`));
} else {
    console.log('\n✓ All rows have data!');
}

// Check for any missing row numbers
const missingRows = [];
for (let row = 0; row < 192; row++) {
    if (!foundRows.has(row)) {
        missingRows.push(row);
    }
}

if (missingRows.length > 0) {
    console.log(`\nMissing row values: ${missingRows.length}`);
    missingRows.slice(0, 20).forEach(row => console.log(`  Row ${row}`));
} else {
    console.log('\n✓ All row values present!');
}

// Check for duplicate offsets
const offsetToRow = new Map();
const duplicates = [];

for (let row = 0; row < 192; row++) {
    const offset = rowToHgrOffset(row);
    if (offsetToRow.has(offset)) {
        duplicates.push({ row, offset, conflictsWith: offsetToRow.get(offset) });
    } else {
        offsetToRow.set(offset, row);
    }
}

if (duplicates.length > 0) {
    console.log(`\n✗ Found ${duplicates.length} duplicate offsets!`);
    duplicates.slice(0, 10).forEach(d => {
        console.log(`  Row ${d.row} and row ${d.conflictsWith} both map to 0x${d.offset.toString(16)}`);
    });
} else {
    console.log('\n✓ No duplicate offsets!');
}

console.log('\n=== Summary ===');
if (emptyRows.length === 0 && missingRows.length === 0 && duplicates.length === 0) {
    console.log('✓ PASS: Interleaving is correct, all 192 rows are covered');
    process.exit(0);
} else {
    console.log('✗ FAIL: Problems found with interleaving');
    process.exit(1);
}
