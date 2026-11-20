import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>, extraClass = ""): SVGProps<SVGSVGElement> => ({
  width: props.width ?? 16,
  height: props.height ?? 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  ...props,
  className: `${extraClass} ${props.className ?? ""}`.trim(),
});

export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><circle cx="11" cy="11" r="7.5" /><path d="m20 20-3.8-3.8" /></svg>
);

export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M5 12h14M12 5v14" /></svg>
);

export const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M20 6 9 17l-5-5" /></svg>
);

export const RefreshIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" />
  </svg>
);

export const PauseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
);

export const PlayIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><polygon points="6 3 20 12 6 21 6 3" /></svg>
);

export const RotateCcwIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
);

export const DownloadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);

export const UploadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);

export const SparklesIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
);

export const SunIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
);

export const DropletsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" /><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" /></svg>
);

export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);

export const FilmIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><rect width="20" height="20" x="2" y="2" rx="2.5" /><line x1="7" x2="7" y1="2" y2="22" /><line x1="17" x2="17" y1="2" y2="22" /><line x1="2" x2="22" y1="12" y2="12" /><line x1="2" x2="7" y1="7" y2="7" /><line x1="2" x2="7" y1="17" y2="17" /><line x1="17" x2="22" y1="17" y2="17" /><line x1="17" x2="22" y1="7" y2="7" /></svg>
);

export const ZapIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);

export const CompassIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
);

export const LayoutGridIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="14" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /></svg>
);

export const ImageIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><rect width="18" height="18" x="3" y="3" rx="2.5" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
);

export const SlidersIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><line x1="4" x2="4" y1="21" y2="14" /><line x1="4" x2="4" y1="10" y2="3" /><line x1="12" x2="12" y1="21" y2="12" /><line x1="12" x2="12" y1="8" y2="3" /><line x1="20" x2="20" y1="21" y2="16" /><line x1="20" x2="20" y1="12" y2="3" /><line x1="1" x2="7" y1="14" y2="14" /><line x1="9" x2="15" y1="8" y2="8" /><line x1="17" x2="23" y1="16" y2="16" /></svg>
);

export const HeartIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
);

export const TrashIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
);

export const EditIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
);

export const PackageIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>
);

export const LayersIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
);

export const WrenchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
);

export const CopyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
);

export const FolderOpenIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>
);

export const InfoIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);
