<script lang="ts">
  import { onMount } from "svelte";
  import { Camera, CameraOff, X } from "lucide-svelte";
  import { BrowserMultiFormatReader } from "@zxing/browser";
  import { BarcodeFormat, DecodeHintType } from "@zxing/library";

  let {
    open = $bindable(false),
    onDetected,
  }: {
    open?: boolean;
    onDetected?: (code: string) => void;
  } = $props();

  let video = $state<HTMLVideoElement>();
  let scannerControls: { stop: () => void } | null = null;
  let error = $state("");
  let usingCamera = $state(false);
  let manualCode = $state("");
  let facingMode: "environment" | "user" = "environment";
  let stopRequested = false;

  const supportsCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  function makeReader(): BrowserMultiFormatReader {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ZXing requires a plain Map for decode hints
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
    ]);
    return new BrowserMultiFormatReader(hints);
  }

  async function pickDeviceId(): Promise<string | undefined> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      if (cams.length <= 1) return cams[0]?.deviceId || undefined;
      const preferred = cams.find((d) => (facingMode === "environment" ? d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear") : d.label.toLowerCase().includes("front")));
      return (preferred || cams[0]).deviceId;
    } catch {
      return undefined;
    }
  }

  async function startCamera() {
    error = "";
    if (!supportsCamera) {
      error = "Camera is not supported on this device or browser";
      return;
    }
    try {
      stopRequested = false;
      const deviceId = await pickDeviceId();
      const codeReader = makeReader();
      const controls = await codeReader.decodeFromVideoDevice(deviceId, video!, (result, err) => {
        if (stopRequested) return;
        if (result && result.getText()) {
          onDetected?.(String(result.getText()));
          close();
          return;
        }
        // No result yet — keep scanning; ignore individual frame errors.
        void err;
      });
      scannerControls = controls as unknown as { stop: () => void };
      usingCamera = true;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not access camera";
      usingCamera = false;
    }
  }

  function stopCamera() {
    stopRequested = true;
    if (scannerControls) {
      try {
        scannerControls.stop();
      } catch {
        /* ignore */
      }
      scannerControls = null;
    }
    usingCamera = false;
    if (video) video.srcObject = null;
  }

  function switchCamera() {
    facingMode = facingMode === "environment" ? "user" : "environment";
    stopCamera();
    setTimeout(() => startCamera(), 120);
  }

  function handleManual() {
    const code = manualCode.trim();
    if (!code) return;
    onDetected?.(code);
    manualCode = "";
    close();
  }

  function close() {
    stopCamera();
    open = false;
    error = "";
    manualCode = "";
  }

  $effect(() => {
    if (open) {
      // Wait a tick so the video element is mounted.
      setTimeout(() => startCamera(), 50);
    } else {
      stopCamera();
    }
  });

  onMount(() => {
    return () => stopCamera();
  });
</script>

{#if open}
  <div class="modal modal-open" role="dialog" aria-modal="true">
    <div class="modal-box w-full max-w-md">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="flex items-center gap-2 text-lg font-bold">
          <Camera size={19} class="text-primary" />
          Scan barcode
        </h3>
        <button type="button" class="btn btn-ghost btn-sm btn-square" onclick={close} aria-label="Close scanner">
          <X size={18} />
        </button>
      </div>

      <div class="rounded-box border-base-300 relative overflow-hidden border bg-black">
        {#if usingCamera}
          <video bind:this={video} class="aspect-square w-full object-cover" playsinline muted></video>
          <div class="bg-primary/80 pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2"></div>
          <span class="absolute top-2 right-2 text-[10px] font-semibold tracking-wider text-white/70 uppercase">Scanning…</span>
        {:else if !error}
          <div class="flex aspect-square w-full flex-col items-center justify-center gap-3 text-white/70">
            <Camera size={36} />
            <span class="text-sm">Starting camera…</span>
          </div>
        {:else}
          <div class="flex aspect-square w-full flex-col items-center justify-center gap-2 p-6 text-center">
            <CameraOff size={32} class="text-white/60" />
            <p class="text-sm text-white/80">{error}</p>
          </div>
        {/if}
      </div>

      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-2">
          <label class="input input-bordered flex w-full items-center gap-2">
            <input
              bind:value={manualCode}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleManual();
                }
              }}
              placeholder="Enter barcode or SKU manually"
              autocomplete="off"
            />
          </label>
          <button type="button" class="btn btn-primary" onclick={handleManual}>Add</button>
        </div>
        {#if supportsCamera}
          <button type="button" class="btn btn-outline btn-sm w-full" onclick={switchCamera}>
            <Camera size={15} />
            Switch camera
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
