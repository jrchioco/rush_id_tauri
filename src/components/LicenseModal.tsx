import { X } from "lucide-react";

interface LicenseModalProps {
  open: boolean;
  onClose: () => void;
}

export function LicenseModal({ open, onClose }: LicenseModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl w-[60%] max-w-xl mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">License</h2>
          <button onClick={onClose} className="text-[#555] hover:text-[#888] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <pre className="text-xs text-[#888] font-mono whitespace-pre-wrap leading-relaxed">
{`J3FF Printing Services License
Copyright (c) 2026 Jefferson C. Chioco Jr. / J3FF Printing Services

Permission is granted to use, copy, and modify this software for any
purpose, provided that the above copyright notice appears in all copies.

This software may NOT be:
- Sold, sublicensed, or redistributed for a fee
- Distributed or provided as part of any printing-shop startup package,
  franchise, or business opportunity

For commercial licensing inquiries, contact: jrchioco008@gmail.com

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`}
          </pre>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-[#2a2a28]">
          <button
            onClick={onClose}
            className="px-6 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
