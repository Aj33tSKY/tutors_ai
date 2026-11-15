import type { CSSProperties, ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & { src: string; fill?: boolean; sizes?: string; preload?: boolean; priority?: boolean; width?: number; height?: number; quality?: number };
/** Stands in for `next/image`: same props the marketing components use, rendered as a plain image. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `quality` is accepted and ignored: nothing is re-encoded here.
export default function Image({ fill, preload, priority, quality, style, alt = "", ...props }: Props) {
  const fillStyle: CSSProperties | undefined = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } : undefined;
  // eslint-disable-next-line @next/next/no-img-element -- this IS the image component for the non-Next build.
  return <img alt={alt} loading={preload || priority ? "eager" : "lazy"} decoding="async" style={{ ...fillStyle, ...style }} {...props}/>;
}
