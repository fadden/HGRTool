/**
 * ViterbiTrellis - Manages the trellis data structure for Viterbi algorithm
 *
 * A trellis is a 2D structure with:
 * - Positions (columns): 0 to numPositions-1 (typically 40 for HGR scanline)
 * - States (rows): Different byte values (0x00-0xFF) at each position
 *
 * Each state contains:
 * - byte: The byte value (0x00-0xFF)
 * - cumulativeError: Total accumulated error from start to this state
 * - backpointer: Reference to previous state { position, byte } or null
 */
export default class ViterbiTrellis {
  /**
   * Creates a new Viterbi trellis
   * @param {number} numPositions - Number of byte positions in scanline (typically 40)
   * @param {number} beamWidth - Maximum number of states to keep at each position
   */
  constructor(numPositions, beamWidth) {
    if (numPositions <= 0) {
      throw new Error('numPositions must be positive');
    }
    if (beamWidth <= 0) {
      throw new Error('beamWidth must be positive');
    }

    this.numPositions = numPositions;
    this.beamWidth = beamWidth;

    // Initialize trellis as array of Maps (one Map per position)
    // Each Map stores byte -> state mapping for that position
    this.trellis = [];
    for (let i = 0; i < numPositions; i++) {
      this.trellis.push(new Map());
    }
  }

  /**
   * Validates position is within valid range
   * @param {number} position - Position to validate
   */
  _validatePosition(position) {
    if (position < 0 || position >= this.numPositions) {
      throw new Error(`Invalid position: ${position}. Must be 0-${this.numPositions - 1}`);
    }
  }

  /**
   * Validates byte value is within valid range
   * @param {number} byte - Byte value to validate
   */
  _validateByte(byte) {
    if (byte < 0 || byte > 255) {
      throw new Error(`Invalid byte value: ${byte}. Must be 0-255`);
    }
  }

  /**
   * Sets or updates a state at a specific position
   * @param {number} position - Position in trellis (0 to numPositions-1)
   * @param {number} byte - Byte value for this state (0x00-0xFF)
   * @param {Object} state - State object with { byte, cumulativeError, backpointer }
   */
  setState(position, byte, state) {
    this._validatePosition(position);
    this._validateByte(byte);

    this.trellis[position].set(byte, state);
  }

  /**
   * Retrieves a specific state
   * @param {number} position - Position in trellis
   * @param {number} byte - Byte value for state
   * @returns {Object|undefined} State object or undefined if not found
   */
  getState(position, byte) {
    this._validatePosition(position);
    this._validateByte(byte);

    return this.trellis[position].get(byte);
  }

  /**
   * Gets all states at a specific position
   * @param {number} position - Position in trellis
   * @returns {Array} Array of all state objects at this position
   */
  getStates(position) {
    this._validatePosition(position);

    return Array.from(this.trellis[position].values());
  }

  /**
   * Prunes the beam at a position to keep only the top K states
   * with the lowest cumulative error.
   *
   * CRITICAL FIX: Ensures palette diversity by keeping top K/2 states
   * from EACH hi-bit palette (0x00-0x7F and 0x80-0xFF). This prevents
   * one palette from dominating the beam and blocking exploration of
   * the other palette's colors.
   *
   * @param {number} position - Position to prune
   */
  pruneBeam(position) {
    this._validatePosition(position);

    const states = this.getStates(position);

    // If we have fewer states than beam width, no pruning needed
    if (states.length <= this.beamWidth) {
      return;
    }

    // CRITICAL: Separate states by hi-bit palette
    const hiBit0States = states.filter(s => (s.byte & 0x80) === 0); // 0x00-0x7F
    const hiBit1States = states.filter(s => (s.byte & 0x80) !== 0); // 0x80-0xFF

    // Sort each palette group by cumulative error (ascending)
    hiBit0States.sort((a, b) => a.cumulativeError - b.cumulativeError);
    hiBit1States.sort((a, b) => a.cumulativeError - b.cumulativeError);

    // Keep top K/2 from each palette to ensure diversity
    const halfBeam = Math.floor(this.beamWidth / 2);
    const topHiBit0 = hiBit0States.slice(0, halfBeam);
    const topHiBit1 = hiBit1States.slice(0, halfBeam);

    // Combine the two groups
    const topStates = [...topHiBit0, ...topHiBit1];

    // If one palette has fewer than K/2 states, use remaining slots for other palette
    if (topStates.length < this.beamWidth) {
      const remaining = this.beamWidth - topStates.length;

      // Add more from the palette that has states available
      if (hiBit0States.length > halfBeam) {
        topStates.push(...hiBit0States.slice(halfBeam, halfBeam + remaining));
      } else if (hiBit1States.length > halfBeam) {
        topStates.push(...hiBit1States.slice(halfBeam, halfBeam + remaining));
      }
    }

    // Clear the position and rebuild with only top states
    this.trellis[position].clear();
    for (const state of topStates) {
      this.trellis[position].set(state.byte, state);
    }
  }

  /**
   * Finds the best final state (with lowest cumulative error)
   * at the last position in the trellis
   * @returns {Object|undefined} Best final state or undefined if no states exist
   */
  getBestFinalState() {
    const finalPosition = this.numPositions - 1;
    const finalStates = this.getStates(finalPosition);

    if (finalStates.length === 0) {
      return undefined;
    }

    // Find state with minimum cumulative error
    let bestState = finalStates[0];
    for (let i = 1; i < finalStates.length; i++) {
      if (finalStates[i].cumulativeError < bestState.cumulativeError) {
        bestState = finalStates[i];
      }
    }

    return bestState;
  }
}
