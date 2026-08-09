<script lang="ts">
  import { onMount } from "svelte";
  import { Camera, CameraOff, X } from "lucide-svelte";

  let {
    open = $bindable(false),
    onDetected,
  }: {
    open?: boolean;
    onDetected?: (code: string) => void;
  } = $props();

  let video = $state<HTMLVideoElement>();
  let stream: MediaStream | null = null;
  let detector: any = null;
  let error = $state("");
  let usingCamera = $state(false);
  let manualCode = $state("");
  let facingMode: "environment" | "user" = "environment";
  let rafId = 0;

  const supportsCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const supportsDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

  async function startCamera() {
    error = "";
    if (!supportsCamera) {
      error = "Camera is not supported on this device or browser";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      usingCamera = true;
      if (supportsDetector) {
        try {
          detector = new (window as any).BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "qr_code"],
          });
          scanLoop();
        } catch {
          detector = null;
          error = "Barcode detection is not available in this browser — use the manual field below.";
        }
      } else {
        error = "Barcode detection is not available in this browser — use the manual field below.";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not access camera";
    }
  }

  async function scanLoop() {
    if (!detector || !usingCamera || !video || video.readyState < 2) {
      rafId = requestAnimationFrame(scanLoop);
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length > 0 && codes[0].rawValue) {
        const value = String(codes[0].rawValue);
        onDetected?.(value);
        stopCamera();
        return;
      }
    } catch {
      /* ignore detection frames */
    }
    if (usingCamera) rafId = requestAnimationFrame(scanLoop);
  }

  function stopCamera() {
    usingCamera = false;
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (video) video.srcObject = null;
    detector = null;
  }

  function switchCamera() {
    facingMode = facingMode === "environment" ? "user" : "environment";
    stopCamera();
    setTimeout(() => startCamera(), 50);
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
      startCamera();
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
