let audioContext;
let clickAudio;
let installed = false;
export function buttonSoundsEnabled() {
  return localStorage.getItem("mindkeep-button-sounds") !== "off";
}
export function setButtonSounds(enabled) {
  localStorage.setItem("mindkeep-button-sounds", enabled ? "on" : "off");
}
export async function playButtonSound({ preview = false } = {}) {
  if (!preview && !buttonSoundsEnabled()) return false;
  // Play directly inside the user's click gesture; Web Audio is the fallback.
  try {
    if (window.Audio) {
      clickAudio ||= new window.Audio("/button-click.wav");
      clickAudio.preload = "auto";
      clickAudio.volume = 0.55;
      clickAudio.currentTime = 0;
      await clickAudio.play();
      return true;
    }
  } catch {
    // Try the synthesized tap if the browser cannot play the local audio asset.
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;
  try {
    audioContext ||= new AudioContext();
    if (
      audioContext.state === "suspended" ||
      audioContext.state === "interrupted"
    )
      await audioContext.resume();
    if (audioContext.state !== "running") return false;
    const tone = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const start = audioContext.currentTime;
    tone.type = "sine";
    tone.frequency.setValueAtTime(720, start);
    tone.frequency.exponentialRampToValueAtTime(540, start + 0.11);
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.12, start + 0.006);
    volume.gain.setValueAtTime(0.12, start + 0.035);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    tone.connect(volume);
    volume.connect(audioContext.destination);
    tone.onended = () => {
      tone.disconnect();
      volume.disconnect();
    };
    tone.start(start);
    tone.stop(start + 0.12);
    return true;
  } catch {
    // Audio may be unavailable; button actions must still work normally.
    return false;
  }
}
export function initButtonFeedback() {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.('button, [role="button"]');
      if (
        !event.isTrusted ||
        !button ||
        button.disabled ||
        button.hasAttribute("data-sound-preview") ||
        button.getAttribute("aria-disabled") === "true"
      )
        return;
      // A brief press animation is visible after release, including keyboard clicks.
      if (
        button.animate &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        button.animate(
          [
            { transform: "translateY(-2px) scale(1)" },
            { transform: "translateY(0) scale(0.97)" },
            { transform: "translateY(-2px) scale(1)" },
          ],
          { duration: 180, easing: "ease-out" },
        );
      }
      void playButtonSound();
    },
    { capture: true },
  );
}
