/**
 * Enumerate audio devices. Device labels are usually empty until the user
 * has granted mic permission at least once in the session. If we detect
 * empty labels, we briefly open a mic stream, immediately close it, and
 * re-enumerate.
 */

export async function listDevices() {
  let devs = await navigator.mediaDevices.enumerateDevices();
  const hasLabels = devs.some(d => d.label);

  if (!hasLabels) {
    try {
      // Trigger permission prompt once. We do NOT keep the stream.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      devs = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // Permission denied — return kind-only entries; user will see
      // "Output 12345678" style labels but can still select by index.
    }
  }

  return {
    outputs: devs.filter(d => d.kind === 'audiooutput'),
    inputs: devs.filter(d => d.kind === 'audioinput')
  };
}

/**
 * Find the VB-CABLE playback endpoint by label.
 * The Windows playback device is named "CABLE Input (VB-Audio Virtual Cable)".
 * Games read the *recording* side "CABLE Output".
 *
 * @param {MediaDeviceInfo[]} outputs
 * @returns {MediaDeviceInfo | null}
 */
export function findCableInput(outputs) {
  return outputs.find(d => /^CABLE Input\b/i.test(d.label || ''))
    || outputs.find(d => /CABLE Input/i.test(d.label || ''))
    || null;
}

/**
 * Find the VB-CABLE recording endpoint (used in M2 for mic bypass paths,
 * not needed in M1 — kept here so the label matching logic is centralized).
 */
export function findCableOutput(inputs) {
  return inputs.find(d => /CABLE Output/i.test(d.label || '')) || null;
}