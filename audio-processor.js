const BUFFER_SIZE = 2048;
const RING_CAPACITY = 8192; // power of 2, 4x BUFFER_SIZE
const PCM_SCALE_NEG = 0x8000;
const PCM_SCALE_POS = 0x7FFF;

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer: pre-allocated Float32Array with read/write pointers
    this._ring = new Float32Array(RING_CAPACITY);
    this._mask = RING_CAPACITY - 1;
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const len = channelData.length;

    // Overflow guard: drop oldest samples if ring is full
    if (this._count + len > RING_CAPACITY) {
      const drop = this._count + len - RING_CAPACITY;
      this._readPos = (this._readPos + drop) & this._mask;
      this._count -= drop;
    }

    // Write incoming samples (up to two segments for wrap-around)
    const writeStart = this._writePos & this._mask;
    const firstWrite = Math.min(len, RING_CAPACITY - writeStart);
    this._ring.set(channelData.subarray(0, firstWrite), writeStart);
    if (firstWrite < len) {
      this._ring.set(channelData.subarray(firstWrite), 0);
    }
    this._writePos = (this._writePos + len) & this._mask;
    this._count += len;

    // Drain full chunks: convert Float32 → Int16 PCM inline
    while (this._count >= BUFFER_SIZE) {
      const pcm = new Int16Array(BUFFER_SIZE);
      const readStart = this._readPos & this._mask;
      const firstRead = Math.min(BUFFER_SIZE, RING_CAPACITY - readStart);

      for (let i = 0; i < firstRead; i++) {
        const s = Math.max(-1, Math.min(1, this._ring[readStart + i]));
        pcm[i] = s < 0 ? s * PCM_SCALE_NEG : s * PCM_SCALE_POS;
      }
      for (let i = firstRead; i < BUFFER_SIZE; i++) {
        const s = Math.max(-1, Math.min(1, this._ring[i - firstRead]));
        pcm[i] = s < 0 ? s * PCM_SCALE_NEG : s * PCM_SCALE_POS;
      }

      this._readPos = (this._readPos + BUFFER_SIZE) & this._mask;
      this._count -= BUFFER_SIZE;
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
