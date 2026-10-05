import { useEffect, useRef, useState } from "react";

type Detector = {
  detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>;
};
type DetectorConstructor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};
const detectorClass = () =>
  (window as unknown as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;

async function createDetector(
  Native: DetectorConstructor | undefined,
): Promise<Detector> {
  const formats = [
    "code_128",
    "code_39",
    "qr_code",
    "data_matrix",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
  ];
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const selected = formats.filter((format) => supported.includes(format));
      if (selected.length) return new Native({ formats: selected });
    } catch {
      /* Use the bundled decoder when the native API is unavailable. */
    }
  }
  const { BrowserMultiFormatReader, BarcodeFormat } =
    await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();
  reader.possibleFormats = [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Camera image processing unavailable");
  return {
    async detect(video) {
      if (!video.videoWidth || !video.videoHeight) return [];
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        return [{ rawValue: reader.decodeFromCanvas(canvas).getText() }];
      } catch (error) {
        if (
          [
            "NotFoundException",
            "ChecksumException",
            "FormatException",
          ].includes((error as { getKind?: () => string }).getKind?.() ?? "")
        )
          return [];
        throw error;
      }
    },
  };
}

export function ScanInput({
  name,
  label,
  value,
  multiline,
  optional,
  disabled,
  describedBy,
}: {
  name: string;
  label: string;
  value: string;
  multiline: boolean;
  optional: boolean;
  disabled: boolean;
  describedBy?: string;
}) {
  const [entered, setEntered] = useState(value),
    [active, setActive] = useState(false),
    [candidate, setCandidate] = useState(""),
    [status, setStatus] = useState("");
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const release = () => {
    generation.current++;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  const stop = () => {
    release();
    setActive(false);
  };
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop();
    };
    const leaving = () => stop();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      release();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    };
  }, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  const start = async () => {
    stop();
    setCandidate("");
    const DetectorClass = detectorClass();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus(
        "Camera scanning is unavailable in this browser. Type the value or use a hardware scanner.",
      );
      return;
    }
    const token = generation.current;
    setActive(true);
    setStatus("Waiting for camera access…");
    try {
      const detector = await createDetector(DetectorClass);
      if (generation.current !== token) return;
      const capture = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (generation.current !== token) {
        capture.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = capture;
      const element = video.current!;
      element.srcObject = capture;
      await element.play();
      if (generation.current !== token) return;
      setStatus("Show one label. Review the detected value before using it.");
      const detect = async () => {
        if (generation.current !== token) return;
        try {
          if (element.readyState >= 2) {
            const found = await detector.detect(element);
            if (generation.current !== token) return;
            const values = [
              ...new Set(found.map((f) => f.rawValue.trim()).filter(Boolean)),
            ];
            if (values.length === 1) {
              const serial = values[0]!;
              if (
                serial.length <= 160 &&
                !/[\u0000-\u001f\u007f]/.test(serial)
              ) {
                setCandidate(serial);
                stop();
                setStatus("Review the detected value. Stock has not changed.");
                return;
              }
              setStatus(
                "Label value is invalid. Try another label or enter it manually.",
              );
            } else if (values.length > 1)
              setStatus(
                "More than one label is visible. Show one label at a time.",
              );
          }
          timer.current = setTimeout(() => void detect(), 200);
        } catch {
          if (generation.current !== token) return;
          stop();
          setStatus(
            "Camera scanning failed. Type the value or use a hardware scanner.",
          );
        }
      };
      void detect();
    } catch {
      if (generation.current !== token) return;
      stop();
      setStatus(
        "Camera access unavailable. Type the value or use a hardware scanner.",
      );
    }
  };
  const useCandidate = () => {
    if (
      multiline &&
      entered
        .split(/\r?\n/)
        .map((s) => s.trim())
        .includes(candidate)
    ) {
      setStatus("This serial is already in the list. No value was added.");
      return;
    }
    setEntered(
      multiline
        ? [...entered.split(/\r?\n/).filter((s) => s.trim()), candidate].join(
            "\n",
          )
        : candidate,
    );
    setCandidate("");
    setStatus("Value entered. Save or confirm the form to continue.");
    field.current?.focus();
  };
  const shared = {
    id: `field-${name}`,
    name,
    "aria-describedby": describedBy,
    "aria-labelledby": `field-label-${name}`,
    required: !optional,
    disabled,
    value: entered,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setEntered(event.target.value),
  };
  return (
    <>
      {multiline ? (
        <textarea
          {...shared}
          ref={(element) => {
            field.current = element;
          }}
        />
      ) : (
        <input
          {...shared}
          ref={(element) => {
            field.current = element;
          }}
          onKeyDown={(event) => {
            // A scanner's Enter suffix must not submit a stock-changing command.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      )}
      <div
        className="scan-controls"
        role="region"
        aria-label={`Scanner for ${label}`}
      >
        <button
          type="button"
          className="secondary"
          disabled={disabled || active}
          onClick={() => void start()}
        >
          Scan with camera
        </button>
        {active && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              stop();
              setStatus("Camera stopped.");
            }}
          >
            Stop camera
          </button>
        )}
        <video
          ref={video}
          muted
          playsInline
          hidden={!active}
          aria-label="Camera preview"
        />
        {candidate && (
          <>
            <p>
              Detected: <strong>{candidate}</strong>
            </p>
            <button type="button" disabled={disabled} onClick={useCandidate}>
              Use detected value
            </button>
          </>
        )}
        <p role="status">{status}</p>
      </div>
    </>
  );
}
