"use client";

import { FileDown } from "lucide-react";

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-4xl px-4 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600 text-white">
          <FileDown size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Filevine Project Downloader
          </h1>
          <p className="text-sm text-gray-500">
            Download project documents as a ZIP file
          </p>
        </div>
      </div>
    </header>
  );
}
