import type { Component } from "svelte";

export type NativePage = {
  id: string;
  title: string;
  path: string;
  description: string;
  load: () => Promise<{ default: Component }>;
};

export const pages: NativePage[] = [
  {
    id: "svelte1",
    title: "Svelte 1",
    path: "/svelte1",
    description: "Living Architectural Section prototype.",
    load: () => import("./embedded/svelte1/Page.svelte")
  },
  {
    id: "svelte2",
    title: "Svelte 2",
    path: "/svelte2",
    description: "Board interface iteration.",
    load: () => import("./embedded/svelte2/Page.svelte")
  },
  {
    id: "svelte3",
    title: "Svelte 3",
    path: "/svelte3",
    description: "Cinematic interface iteration.",
    load: () => import("./embedded/svelte3/Page.svelte")
  },
  {
    id: "svelte4",
    title: "Svelte 4",
    path: "/svelte4",
    description: "Mineral atlas experience.",
    load: () => import("./embedded/svelte4/Page.svelte")
  },
  {
    id: "svelte5",
    title: "Svelte 5",
    path: "/svelte5",
    description: "Camera ritual experience.",
    load: () => import("./embedded/svelte5/Page.svelte")
  },
  {
    id: "react-1",
    title: "React 1",
    path: "/react-1",
    description: "React frontend draft 01.",
    load: () => import("./embedded/react-1/Page.svelte")
  },
  {
    id: "react-2",
    title: "React 2",
    path: "/react-2",
    description: "React frontend draft 02.",
    load: () => import("./embedded/react-2/Page.svelte")
  },
  {
    id: "react-3",
    title: "React 3",
    path: "/react-3",
    description: "React digital twin draft 03.",
    load: () => import("./embedded/react-3/Page.svelte")
  },
  {
    id: "react-4",
    title: "React 4",
    path: "/react-4",
    description: "React inspection draft 04.",
    load: () => import("./embedded/react-4/Page.svelte")
  },
  {
    id: "react-5",
    title: "React 5",
    path: "/react-5",
    description: "React blueprint atlas draft 05.",
    load: () => import("./embedded/react-5/Page.svelte")
  }
];

export function findPage(pathname: string) {
  return pages.find((page) => pathname === page.path) ?? null;
}
