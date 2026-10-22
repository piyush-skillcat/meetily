import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button 
          ref={ref} 
          className={`flex items-center justify-center cursor-pointer border-none transition-colors ${
            isCollapsed
              ? "h-8 w-8 bg-transparent rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-200"
              : "w-full px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-md"
          }`}
          title="About Notesify"
        >
          <InfoIcon className="w-4 h-4" />
          {!isCollapsed && (
            <span className="ml-2 text-sm text-gray-700">About</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Notesify</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info; 