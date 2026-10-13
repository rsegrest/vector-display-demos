import { DemoHost, bindEscapeToIndex, readIntegerParameter, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { AudioOutput } from "./audio/AudioOutput.js";
import { OSCILLOSCOPE_WORLD_HEIGHT, OscilloscopeDemo, PROGRAMS, TRAIL_MODES } from "./OscilloscopeDemo.js";

const VOLUME_STEP = 0.04;

// Runs the oscilloscope full screen. It starts silent, because browsers do not let
// a page make sound until the visitor has pressed something; S (or a click) turns
// the sound on. ?figure= (1-based) picks the starting figure.
export function startOscilloscope(canvas: HTMLCanvasElement): void {
  const demo = new OscilloscopeDemo({ programIndex: readIntegerParameter("figure", 1, 1, PROGRAMS.length) - 1 });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: OSCILLOSCOPE_WORLD_HEIGHT,
      // The trace is one long chain of tiny segments: no endpoint dwell, and enough
      // overlap that the joints do not show as gaps.
      lineStyle: { beamWidth: 1.5, glowRadius: 3.2, glowStrength: 0.22, endpointBrightness: 0, jointOverlap: 0.5 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.7,
        bloomBlurIterations: 2,
        exposure: 1.3,
        flickerAmount: 0.03,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The oscilloscope needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  // Created on first use: making an audio context before the visitor asks for sound earns a console warning.
  let audio: AudioOutput | null = null;
  // Whether the visitor wants sound, which a pause interrupts but does not change.
  let soundWanted = false;

  const getAudio = (): AudioOutput => {
    if (!audio) {
      audio = new AudioOutput(demo.engine);
      audio.setVolume(demo.volume);
    }
    return audio;
  };

  const startSound = async (): Promise<void> => {
    const output = getAudio();
    try {
      await output.start(demo.playhead);
    } catch (error) {
      console.error(error);
      demo.showBanner("SOUND UNAVAILABLE");
      return;
    }
    if (!output.isRunning) {
      demo.showBanner("PRESS S FOR SOUND");
      return;
    }
    demo.followAudio(() => output.playheadSample());
  };

  const stopSound = async (): Promise<void> => {
    demo.followAudio(null);
    await audio?.stop();
  };

  const setSoundWanted = (wanted: boolean): void => {
    soundWanted = wanted;
    demo.showBanner(wanted ? "SOUND ON" : "SOUND OFF");
    if (wanted && !demo.isPaused) void startSound();
    else void stopSound();
  };

  const togglePause = (): void => {
    demo.togglePause();
    if (!soundWanted) return;
    if (demo.isPaused) void stopSound();
    else void startSound();
  };

  const changeVolume = (delta: number): void => {
    demo.volume = Math.max(0, Math.min(1, demo.volume + delta));
    audio?.setVolume(demo.volume);
    demo.showBanner(`VOLUME ${Math.round(demo.volume * 100)}`);
  };

  const playFile = async (file: File): Promise<void> => {
    demo.showBanner("LOADING");
    try {
      const { left, right } = await getAudio().decode(await file.arrayBuffer());
      demo.loadRecording(file.name.replace(/\.[^.]+$/, ""), left, right);
      if (!soundWanted) setSoundWanted(true);
    } catch (error) {
      console.error(error);
      demo.showBanner("COULD NOT READ THAT FILE");
    }
  };

  const filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.accept = "audio/*";
  filePicker.style.display = "none";
  filePicker.setAttribute("aria-label", "Open an audio file to play through the oscilloscope");
  document.body.appendChild(filePicker);
  filePicker.addEventListener("change", () => {
    const file = filePicker.files?.[0];
    if (file) void playFile(file);
    filePicker.value = "";
  });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "s": case "S": case "Enter": setSoundWanted(!soundWanted); break;
      case "n": case "N": case "ArrowRight": demo.changeProgram(1); break;
      case "b": case "B": case "ArrowLeft": demo.changeProgram(-1); break;
      case "ArrowUp": demo.changePitch(1); break;
      case "ArrowDown": demo.changePitch(-1); break;
      case "[": demo.changeMotion(-1); break;
      case "]": demo.changeMotion(1); break;
      case "-": case "_": changeVolume(-VOLUME_STEP); break;
      case "=": case "+": changeVolume(VOLUME_STEP); break;
      case "o": case "O": filePicker.click(); break;
      case "a": case "A": demo.toggleAuto(); break;
      case "t": case "T": demo.cycleTrails(); break;
      case "k": case "K": demo.cyclePhosphor(); break;
      case "g": case "G": demo.toggleGraticule(); break;
      case " ": togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      history.replaceState(null, "", `?figure=${demo.program + 1}`);
    }
  });

  canvas.style.cursor = "pointer";
  canvas.addEventListener("pointerdown", () => {
    demo.noteActivity();
    // A click is the obvious thing to try on a silent page.
    if (!soundWanted) setSoundWanted(true);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") demo.noteActivity();
  });

  // An audio file dropped anywhere on the page plays through the scope.
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void playFile(file);
  });

  (window as unknown as { oscilloscope: unknown }).oscilloscope = { demo, host, getAudio, setSoundWanted };
}
