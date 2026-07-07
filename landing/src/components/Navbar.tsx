import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import QuorumMark from "./QuorumMark";

const LINKS = ["procedure", "cases", "documentation", "the record"];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed top-0 left-0 w-full z-[60] bg-bg-base/90 backdrop-blur-[3px] border-b border-ink">
      <div className="max-w-[1180px] mx-auto px-7 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QuorumMark size={20} />
          <span className="font-plate text-[22px] leading-none">Quorum</span>
        </div>
        <nav className="hidden md:flex gap-6">
          {LINKS.map((l) => (
            <a key={l} href="#" className="font-sans text-[12px] lowercase text-ink-soft hover:text-ink transition-colors">
              {l}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href="#" className="inline-flex items-center gap-1.5 bg-ink text-white font-sans text-[12px] font-600 px-3.5 py-1.5 hover:bg-oxblood transition-colors">
            open a cause <span aria-hidden>&rarr;</span>
          </a>
          <button
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px]"
          >
            <motion.span animate={open ? { rotate: 45, y: 6 } : {}} className="block w-5 h-[2px] bg-ink" />
            <motion.span animate={open ? { opacity: 0 } : { opacity: 1 }} className="block w-5 h-[2px] bg-ink" />
            <motion.span animate={open ? { rotate: -45, y: -6 } : {}} className="block w-5 h-[2px] bg-ink" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden overflow-hidden border-t border-hair"
          >
            <div className="flex flex-col px-7 py-2">
              {LINKS.map((l) => (
                <a key={l} href="#" className="font-sans text-[14px] lowercase text-ink-soft py-2 border-b border-hair last:border-0">
                  {l}
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
