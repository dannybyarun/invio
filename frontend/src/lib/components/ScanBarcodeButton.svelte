<script lang="ts">
  import { getContext } from "svelte";
  import { Barcode, Camera } from "lucide-svelte";
  import BarcodeScannerModal from "./BarcodeScannerModal.svelte";

  let {
    onDetected,
    label,
    variant = "outline",
    size = "sm",
  }: {
    onDetected?: (code: string) => void;
    label?: string;
    variant?: "outline" | "primary";
    size?: "sm" | "md";
  } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let open = $state(false);

  function handle(code: string) {
    onDetected?.(code);
  }
</script>

<button type="button" class={`btn btn-${variant} btn-${size}`} onclick={() => (open = true)} aria-label={label || t("Scan barcode")} title={label || t("Scan barcode")}>
  <Camera size={15} />
  {label || t("Scan barcode")}
</button>

<BarcodeScannerModal {open} onDetected={handle} />
