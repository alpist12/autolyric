export interface PitchResult {
  frequency: number;
  midi: number;
  clarity: number;
  rms: number;
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function detectPitchYin(
  samples: Float32Array,
  sampleRate: number,
  options: { minFrequency?: number; maxFrequency?: number; threshold?: number; minRms?: number } = {},
): PitchResult | null {
  const minFrequency = options.minFrequency ?? 55;
  const maxFrequency = options.maxFrequency ?? 1760;
  const threshold = options.threshold ?? 0.15;
  const minRms = options.minRms ?? 0.01;
  if (samples.length < 32 || sampleRate <= 0 || minFrequency <= 0 || maxFrequency <= minFrequency) return null;

  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < minRms) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(samples.length / 2));
  const difference = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < samples.length - tau; index += 1) {
      const delta = samples[index]! - samples[index + tau]!;
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const normalized = new Float32Array(maxTau + 1);
  normalized[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau]!;
    normalized[tau] = runningSum === 0 ? 1 : (difference[tau]! * tau) / runningSum;
  }

  let tau = minTau;
  while (tau <= maxTau && normalized[tau]! >= threshold) tau += 1;
  if (tau > maxTau) return null;
  while (tau + 1 <= maxTau && normalized[tau + 1]! < normalized[tau]!) tau += 1;

  const left = normalized[tau - 1] ?? normalized[tau]!;
  const center = normalized[tau]!;
  const right = normalized[tau + 1] ?? center;
  const denominator = 2 * (2 * center - right - left);
  const refinedTau = denominator === 0 ? tau : tau + (right - left) / denominator;
  const frequency = sampleRate / refinedTau;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;
  return { frequency, midi: frequencyToMidi(frequency), clarity: Math.max(0, 1 - center), rms };
}
