import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MicCapture } from '../../src/audio/micCapture.js';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

class AudioParamMock {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(['set', value, time]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(['ramp', value, time]);
  }
}

class AudioNodeMock {
  constructor() {
    this.connections = [];
    this.gain = new AudioParamMock();
    this.frequency = new AudioParamMock();
    this.Q = new AudioParamMock();
  }

  connect(destination) {
    this.connections.push(destination);
  }

  disconnect() {
    this.connections = [];
  }
}

function makeContext() {
  const destination = new AudioNodeMock();
  const oscillators = [];
  return {
    currentTime: 5,
    destination,
    oscillators,
    createGain: () => new AudioNodeMock(),
    createWaveShaper: () => new AudioNodeMock(),
    createBiquadFilter: () => new AudioNodeMock(),
    createOscillator: () => {
      const oscillator = new AudioNodeMock();
      oscillator.start = () => { oscillator.started = true; };
      oscillator.stop = () => { oscillator.stopped = true; };
      oscillators.push(oscillator);
      return oscillator;
    },
    createMediaStreamSource: () => new AudioNodeMock()
  };
}

function setupMic() {
  const track = {
    stopped: false,
    addEventListener() {},
    stop() { this.stopped = true; }
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  let constraints;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(value) {
          constraints = value;
          return stream;
        }
      }
    }
  });
  const ctx = makeContext();
  const mic = new MicCapture(ctx, ctx.destination);
  return { ctx, mic, stream, track, getConstraints: () => constraints };
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    delete globalThis.navigator;
  }
});

test('starts muted, fades in smoothly, and requests noise suppression', async () => {
  const { ctx, mic, stream, getConstraints } = setupMic();
  mic.setGain(1.4);

  assert.equal(await mic.start('mic-1'), stream);
  const constraints = getConstraints();
  assert.equal(constraints.audio.deviceId.exact, 'mic-1');
  assert.equal(constraints.audio.noiseSuppression, true);
  assert.equal(constraints.audio.autoGainControl, false);
  assert.deepEqual(mic.gainNode.gain.events, [
    ['set', 0, ctx.currentTime],
    ['ramp', 1.4, ctx.currentTime + 0.08]
  ]);
  assert.deepEqual(mic.gainNode.connections, [ctx.destination]);
  mic.dispose();
});

test('provides normal, low-fi bass, and horror signal chains', async () => {
  const { ctx, mic } = setupMic();
  await mic.start();

  mic.setEffect('lowFiBass');
  assert.ok(mic.lowFiShaper.curve instanceof Float32Array);
  assert.equal(mic.lowFiBass.gain.value, 8);
  assert.deepEqual(mic.lowFiLowpass.connections, [ctx.destination]);

  mic.setEffect('horror');
  assert.equal(ctx.oscillators[0].started, true);
  assert.deepEqual(mic.horrorTremolo.connections, [ctx.destination]);

  mic.setEffect('normal');
  assert.deepEqual(mic.gainNode.connections, [ctx.destination]);
  assert.throws(() => mic.setEffect('radio'), /Unsupported microphone effect/);
  mic.dispose();
});
