/**
 * Canonical HGR Byte Patterns for Hybrid Viterbi Dithering
 *
 * This module defines a curated set of 48 HGR byte patterns that represent
 * the most useful pixel combinations for image dithering. These patterns cover:
 * - Grayscale densities (solid blacks, grays, whites)
 * - Color artifact patterns (alternating pixels that produce NTSC colors)
 * - Dither patterns (checkerboards, diagonals, mixed densities)
 *
 * Each pattern is 7 bits (bit 0-6), with bit 7 (high bit) tested separately
 * during the dithering process. This gives us 48 × 2 = 96 total states per byte.
 *
 * Based on empirical analysis of effective HGR patterns for photo conversion.
 */

/**
 * Canonical HGR byte patterns (lower 7 bits only, 0x00-0x7F)
 * @type {number[]}
 */
export const CANONICAL_PATTERNS = [
    // === GRAYSCALE DENSITIES (16 patterns) ===
    // Increasing bit density from 0 to 7 bits set

    0x00,  // 0000000 - Solid black (0/7 bits)
    0x40,  // 1000000 - Single bit (1/7 bits)
    0x08,  // 0001000 - Single bit middle (1/7 bits)
    0x01,  // 0000001 - Single bit edge (1/7 bits)

    0x10,  // 0010000 - 2 bits sparse (1/7 bits distributed)
    0x11,  // 0010001 - 2 bits edges (2/7 bits)
    0x22,  // 0100010 - 2 bits alternating (2/7 bits)

    0x24,  // 0100100 - 2 bits (2/7 bits)
    0x44,  // 1001000 - 3 bits (2/7 bits but looks denser)
    0x14,  // 0010100 - 2 bits (2/7 bits)

    0x49,  // 1001001 - 3 bits edges+middle (3/7 bits)
    0x29,  // 0101001 - 3 bits (3/7 bits)

    0x55,  // 1010101 - Checkerboard (4/7 bits)
    0x6D,  // 1101101 - Dense (5/7 bits)
    0x77,  // 1110111 - Very dense (6/7 bits)
    0x7F,  // 1111111 - Solid white (7/7 bits)

    // === ALTERNATING PATTERNS (8 patterns) ===
    // These produce NTSC color artifacts

    // Even phase alternating (produces purple/green on even columns)
    0x55,  // 1010101 - Pure alternating (duplicate from above, key pattern)
    0x54,  // 1010100 - Alternating with gap
    0x15,  // 0010101 - Alternating partial
    0x05,  // 0000101 - Alternating start

    // Odd phase alternating (produces orange/blue on odd columns)
    0x2A,  // 0101010 - Pure alternating inverse
    0x6A,  // 1101010 - Alternating with extra bit
    0x35,  // 0110101 - Alternating mixed
    0x1A,  // 0011010 - Alternating partial

    // === DITHER PATTERNS (24 patterns) ===
    // Patterns useful for error diffusion and texture

    // Sparse patterns (low density)
    0x02,  // 0000010 - Single bit position 1
    0x04,  // 0000100 - Single bit position 2
    0x20,  // 0100000 - Single bit position 5
    0x09,  // 0001001 - Bits at edges

    // Low-mid density patterns
    0x12,  // 0010010 - Diagonal-like
    0x21,  // 0100001 - Edges separated
    0x18,  // 0011000 - Center cluster
    0x42,  // 1000010 - Edges far apart

    // Mid density patterns
    0x25,  // 0100101 - Mixed pattern
    0x52,  // 1010010 - Alternating variant
    0x4A,  // 1001010 - Mixed bits
    0x2D,  // 0101101 - Diagonal-heavy

    // Mid-high density patterns
    0x5A,  // 1011010 - Complex pattern
    0x6B,  // 1101011 - Dense alternating
    0x56,  // 1010110 - Shifted checkerboard
    0x5D,  // 1011101 - Dense mixed

    // High density patterns
    0x76,  // 1110110 - Nearly solid (6/7)
    0x7D,  // 1111101 - Nearly solid alt (6/7)
    0x7B,  // 1111011 - Nearly solid (6/7)
    0x6F,  // 1101111 - Nearly solid (6/7)

    // Edge patterns (useful for transitions)
    0x07,  // 0000111 - Right edge solid
    0x70,  // 1110000 - Left edge solid
    0x38,  // 0111000 - Center filled
    0x1C,  // 0011100 - Inner center
];

/**
 * Pattern characteristics for each canonical pattern
 * Used for fast filtering and adaptive selection
 */
export const PATTERN_INFO = CANONICAL_PATTERNS.map(pattern => ({
    value: pattern,
    bitCount: countBits(pattern),
    hasAlternating: isAlternating(pattern),
    density: countBits(pattern) / 7.0,
}));

/**
 * Count the number of set bits in a 7-bit pattern
 * @param {number} pattern - Pattern value (0x00-0x7F)
 * @returns {number} - Number of bits set (0-7)
 */
function countBits(pattern) {
    let count = 0;
    for (let i = 0; i < 7; i++) {
        if (pattern & (1 << i)) count++;
    }
    return count;
}

/**
 * Check if pattern is alternating (produces NTSC color artifacts)
 * @param {number} pattern - Pattern value (0x00-0x7F)
 * @returns {boolean} - True if pattern alternates
 */
function isAlternating(pattern) {
    // Check for alternating bit pattern like 0101010 or 1010101
    // We'll check if adjacent bits are different for most positions
    let alternations = 0;
    for (let i = 0; i < 6; i++) {
        const bit1 = (pattern >> i) & 1;
        const bit2 = (pattern >> (i + 1)) & 1;
        if (bit1 !== bit2) alternations++;
    }
    // Consider it alternating if 4+ adjacent pairs differ
    return alternations >= 4;
}

/**
 * Get patterns in a specific density range
 * @param {number} minDensity - Minimum density (0.0-1.0)
 * @param {number} maxDensity - Maximum density (0.0-1.0)
 * @returns {number[]} - Patterns in the density range
 */
export function getPatternsInDensityRange(minDensity, maxDensity) {
    return PATTERN_INFO
        .filter(info => info.density >= minDensity && info.density <= maxDensity)
        .map(info => info.value);
}

/**
 * Get alternating patterns (produce NTSC color artifacts)
 * @returns {number[]} - Alternating patterns
 */
export function getAlternatingPatterns() {
    return PATTERN_INFO
        .filter(info => info.hasAlternating)
        .map(info => info.value);
}

/**
 * Find the closest canonical pattern to a target density
 * @param {number} targetDensity - Target density (0.0-1.0)
 * @returns {number} - Closest pattern
 */
export function getClosestPatternByDensity(targetDensity) {
    let closest = CANONICAL_PATTERNS[0];
    let minDiff = Math.abs(targetDensity);

    for (const info of PATTERN_INFO) {
        const diff = Math.abs(info.density - targetDensity);
        if (diff < minDiff) {
            minDiff = diff;
            closest = info.value;
        }
    }

    return closest;
}

/**
 * Export pattern count for validation
 */
export const PATTERN_COUNT = CANONICAL_PATTERNS.length;

// Validate we have the expected number of patterns
if (PATTERN_COUNT !== 48) {
    console.warn(`Expected 48 canonical patterns, but found ${PATTERN_COUNT}`);
}
