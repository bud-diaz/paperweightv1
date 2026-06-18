class PaperweightPCM extends AudioWorkletProcessor {
  constructor() { super(); this._buf = []; this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this._buf.push(new Float32Array(ch));
    this._n += ch.length;
    if (this._n >= 88200) {
      const out = new Float32Array(this._n);
      let off = 0;
      for (const f of this._buf) { out.set(f, off); off += f.length; }
      this.port.postMessage(out, [out.buffer]);
      this._buf = []; this._n = 0;
    }
    return true;
  }
}
registerProcessor('pw-pcm', PaperweightPCM);
