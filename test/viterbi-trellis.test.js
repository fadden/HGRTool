import { describe, it, expect, beforeEach } from 'vitest';
import ViterbiTrellis from '../docs/src/lib/viterbi-trellis.js';

describe('ViterbiTrellis', () => {
  describe('initialization', () => {
    it('should create an instance with correct parameters', () => {
      const trellis = new ViterbiTrellis(40, 16);
      expect(trellis).toBeInstanceOf(ViterbiTrellis);
      expect(trellis.numPositions).toBe(40);
      expect(trellis.beamWidth).toBe(16);
    });

    it('should initialize with empty states at all positions', () => {
      const trellis = new ViterbiTrellis(40, 16);
      for (let pos = 0; pos < 40; pos++) {
        expect(trellis.getStates(pos)).toEqual([]);
      }
    });

    it('should throw error for invalid parameters', () => {
      expect(() => new ViterbiTrellis(0, 16)).toThrow();
      expect(() => new ViterbiTrellis(40, 0)).toThrow();
      expect(() => new ViterbiTrellis(-1, 16)).toThrow();
      expect(() => new ViterbiTrellis(40, -1)).toThrow();
    });
  });

  describe('state management', () => {
    let trellis;

    beforeEach(() => {
      trellis = new ViterbiTrellis(40, 16);
    });

    it('should set and retrieve a single state', () => {
      const state = {
        byte: 0x2A,
        cumulativeError: 10.5,
        backpointer: null
      };

      trellis.setState(0, 0x2A, state);
      const retrieved = trellis.getState(0, 0x2A);

      expect(retrieved).toEqual(state);
      expect(retrieved.byte).toBe(0x2A);
      expect(retrieved.cumulativeError).toBe(10.5);
      expect(retrieved.backpointer).toBe(null);
    });

    it('should set and retrieve multiple states at same position', () => {
      const state1 = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      const state2 = { byte: 0x55, cumulativeError: 12.3, backpointer: null };
      const state3 = { byte: 0x7F, cumulativeError: 8.1, backpointer: null };

      trellis.setState(0, 0x2A, state1);
      trellis.setState(0, 0x55, state2);
      trellis.setState(0, 0x7F, state3);

      expect(trellis.getState(0, 0x2A)).toEqual(state1);
      expect(trellis.getState(0, 0x55)).toEqual(state2);
      expect(trellis.getState(0, 0x7F)).toEqual(state3);
    });

    it('should retrieve all states at a position', () => {
      const state1 = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      const state2 = { byte: 0x55, cumulativeError: 12.3, backpointer: null };
      const state3 = { byte: 0x7F, cumulativeError: 8.1, backpointer: null };

      trellis.setState(5, 0x2A, state1);
      trellis.setState(5, 0x55, state2);
      trellis.setState(5, 0x7F, state3);

      const states = trellis.getStates(5);
      expect(states.length).toBe(3);
      expect(states).toContainEqual(state1);
      expect(states).toContainEqual(state2);
      expect(states).toContainEqual(state3);
    });

    it('should return undefined for non-existent state', () => {
      const retrieved = trellis.getState(0, 0xFF);
      expect(retrieved).toBeUndefined();
    });

    it('should update existing state with same byte value', () => {
      const state1 = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      const state2 = { byte: 0x2A, cumulativeError: 8.0, backpointer: { position: 0, byte: 0x15 } };

      trellis.setState(1, 0x2A, state1);
      trellis.setState(1, 0x2A, state2);

      const retrieved = trellis.getState(1, 0x2A);
      expect(retrieved.cumulativeError).toBe(8.0);
      expect(retrieved.backpointer).toEqual({ position: 0, byte: 0x15 });
    });

    it('should handle states at different positions independently', () => {
      const state1 = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      const state2 = { byte: 0x2A, cumulativeError: 12.3, backpointer: null };

      trellis.setState(0, 0x2A, state1);
      trellis.setState(1, 0x2A, state2);

      expect(trellis.getState(0, 0x2A).cumulativeError).toBe(10.5);
      expect(trellis.getState(1, 0x2A).cumulativeError).toBe(12.3);
    });

    it('should throw error for invalid position', () => {
      const state = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      expect(() => trellis.setState(-1, 0x2A, state)).toThrow();
      expect(() => trellis.setState(40, 0x2A, state)).toThrow();
      expect(() => trellis.getState(-1, 0x2A)).toThrow();
      expect(() => trellis.getState(40, 0x2A)).toThrow();
    });

    it('should throw error for invalid byte value', () => {
      const state = { byte: 0x2A, cumulativeError: 10.5, backpointer: null };
      expect(() => trellis.setState(0, -1, state)).toThrow();
      expect(() => trellis.setState(0, 256, state)).toThrow();
      expect(() => trellis.getState(0, -1)).toThrow();
      expect(() => trellis.getState(0, 256)).toThrow();
    });
  });

  describe('beam pruning', () => {
    let trellis;

    beforeEach(() => {
      trellis = new ViterbiTrellis(40, 4); // Small beam width for testing
    });

    it('should keep all states when count is below beam width', () => {
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 20.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 15.0, backpointer: null });

      trellis.pruneBeam(0);

      expect(trellis.getStates(0).length).toBe(3);
    });

    it('should prune to beam width keeping lowest error states', () => {
      // Add 6 states with different errors
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 30.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 50.0, backpointer: null });
      trellis.setState(0, 0x04, { byte: 0x04, cumulativeError: 20.0, backpointer: null });
      trellis.setState(0, 0x05, { byte: 0x05, cumulativeError: 15.0, backpointer: null });
      trellis.setState(0, 0x06, { byte: 0x06, cumulativeError: 40.0, backpointer: null });

      trellis.pruneBeam(0);

      const remainingStates = trellis.getStates(0);
      expect(remainingStates.length).toBe(4); // Beam width is 4

      // Check that we kept the 4 lowest error states
      const errors = remainingStates.map(s => s.cumulativeError).sort((a, b) => a - b);
      expect(errors).toEqual([10.0, 15.0, 20.0, 30.0]);
    });

    it('should remove correct states after pruning', () => {
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 30.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 50.0, backpointer: null });
      trellis.setState(0, 0x04, { byte: 0x04, cumulativeError: 20.0, backpointer: null });
      trellis.setState(0, 0x05, { byte: 0x05, cumulativeError: 15.0, backpointer: null });

      trellis.pruneBeam(0);

      // Should keep: 0x02 (10.0), 0x05 (15.0), 0x04 (20.0), 0x01 (30.0)
      // Should remove: 0x03 (50.0)
      expect(trellis.getState(0, 0x02)).toBeDefined();
      expect(trellis.getState(0, 0x05)).toBeDefined();
      expect(trellis.getState(0, 0x04)).toBeDefined();
      expect(trellis.getState(0, 0x01)).toBeDefined();
      expect(trellis.getState(0, 0x03)).toBeUndefined();
    });

    it('should handle ties in cumulative error consistently', () => {
      // Add states with identical errors
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x04, { byte: 0x04, cumulativeError: 20.0, backpointer: null });
      trellis.setState(0, 0x05, { byte: 0x05, cumulativeError: 20.0, backpointer: null });

      trellis.pruneBeam(0);

      const remainingStates = trellis.getStates(0);
      expect(remainingStates.length).toBe(4);

      // All remaining should have error <= 20.0
      remainingStates.forEach(state => {
        expect(state.cumulativeError).toBeLessThanOrEqual(20.0);
      });
    });

    it('should not affect other positions when pruning', () => {
      // Add states to position 0
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 30.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 50.0, backpointer: null });

      // Add states to position 1
      trellis.setState(1, 0x01, { byte: 0x01, cumulativeError: 100.0, backpointer: null });
      trellis.setState(1, 0x02, { byte: 0x02, cumulativeError: 200.0, backpointer: null });

      trellis.pruneBeam(0);

      // Position 1 should be unchanged
      expect(trellis.getStates(1).length).toBe(2);
      expect(trellis.getState(1, 0x01).cumulativeError).toBe(100.0);
      expect(trellis.getState(1, 0x02).cumulativeError).toBe(200.0);
    });
  });

  describe('backtracking', () => {
    let trellis;

    beforeEach(() => {
      trellis = new ViterbiTrellis(5, 16); // Shorter trellis for easier testing
    });

    it('should find best final state with lowest cumulative error', () => {
      trellis.setState(4, 0x01, { byte: 0x01, cumulativeError: 30.0, backpointer: null });
      trellis.setState(4, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(4, 0x03, { byte: 0x03, cumulativeError: 50.0, backpointer: null });

      const best = trellis.getBestFinalState();

      expect(best).toBeDefined();
      expect(best.byte).toBe(0x02);
      expect(best.cumulativeError).toBe(10.0);
    });

    it('should return undefined when no final states exist', () => {
      const best = trellis.getBestFinalState();
      expect(best).toBeUndefined();
    });

    it('should reconstruct path through backpointers', () => {
      // Build a simple path: pos0 -> pos1 -> pos2
      trellis.setState(0, 0x01, {
        byte: 0x01,
        cumulativeError: 5.0,
        backpointer: null
      });

      trellis.setState(1, 0x02, {
        byte: 0x02,
        cumulativeError: 10.0,
        backpointer: { position: 0, byte: 0x01 }
      });

      trellis.setState(2, 0x03, {
        byte: 0x03,
        cumulativeError: 15.0,
        backpointer: { position: 1, byte: 0x02 }
      });

      // Start from final state and follow backpointers
      let currentState = trellis.getState(2, 0x03);
      const path = [currentState.byte];

      while (currentState.backpointer !== null) {
        const bp = currentState.backpointer;
        currentState = trellis.getState(bp.position, bp.byte);
        path.unshift(currentState.byte);
      }

      expect(path).toEqual([0x01, 0x02, 0x03]);
    });

    it('should handle multiple competing paths and select best', () => {
      // Build two paths with different cumulative errors
      // Path 1: 0x01 -> 0x02 -> 0x03 (total error: 30.0)
      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 5.0, backpointer: null });
      trellis.setState(1, 0x02, { byte: 0x02, cumulativeError: 15.0, backpointer: { position: 0, byte: 0x01 } });
      trellis.setState(4, 0x03, { byte: 0x03, cumulativeError: 30.0, backpointer: { position: 1, byte: 0x02 } });

      // Path 2: 0x10 -> 0x20 -> 0x30 (total error: 20.0)
      trellis.setState(0, 0x10, { byte: 0x10, cumulativeError: 3.0, backpointer: null });
      trellis.setState(1, 0x20, { byte: 0x20, cumulativeError: 8.0, backpointer: { position: 0, byte: 0x10 } });
      trellis.setState(4, 0x30, { byte: 0x30, cumulativeError: 20.0, backpointer: { position: 1, byte: 0x20 } });

      const best = trellis.getBestFinalState();
      expect(best.byte).toBe(0x30); // Lower cumulative error
      expect(best.cumulativeError).toBe(20.0);
    });

    it('should handle path reconstruction with null start backpointer', () => {
      trellis.setState(0, 0x01, {
        byte: 0x01,
        cumulativeError: 5.0,
        backpointer: null
      });

      const state = trellis.getState(0, 0x01);
      expect(state.backpointer).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle single position trellis', () => {
      const trellis = new ViterbiTrellis(1, 16);

      trellis.setState(0, 0x2A, { byte: 0x2A, cumulativeError: 10.0, backpointer: null });

      expect(trellis.getStates(0).length).toBe(1);
      expect(trellis.getBestFinalState().byte).toBe(0x2A);
    });

    it('should handle beam width of 1', () => {
      const trellis = new ViterbiTrellis(5, 1);

      trellis.setState(0, 0x01, { byte: 0x01, cumulativeError: 30.0, backpointer: null });
      trellis.setState(0, 0x02, { byte: 0x02, cumulativeError: 10.0, backpointer: null });
      trellis.setState(0, 0x03, { byte: 0x03, cumulativeError: 20.0, backpointer: null });

      trellis.pruneBeam(0);

      expect(trellis.getStates(0).length).toBe(1);
      expect(trellis.getState(0, 0x02)).toBeDefined(); // Lowest error
    });

    it('should handle empty trellis gracefully', () => {
      const trellis = new ViterbiTrellis(5, 16);

      expect(trellis.getBestFinalState()).toBeUndefined();
      expect(trellis.getStates(0)).toEqual([]);
    });

    it('should handle all 256 possible byte values', () => {
      const trellis = new ViterbiTrellis(1, 256);

      // Add state for each possible byte value
      for (let byte = 0; byte < 256; byte++) {
        trellis.setState(0, byte, {
          byte,
          cumulativeError: byte,
          backpointer: null
        });
      }

      expect(trellis.getStates(0).length).toBe(256);

      // Verify each byte can be retrieved
      for (let byte = 0; byte < 256; byte++) {
        expect(trellis.getState(0, byte).byte).toBe(byte);
      }
    });
  });
});
