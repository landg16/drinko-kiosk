import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

export function ConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Cancel Order?',
  description = 'Are you sure you want to cancel? Your current selection will be lost.',
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center gap-6">
        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>
        
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">{title}</h2>
          <p className="text-xl text-zinc-400">{description}</p>
        </div>

        <div className="flex gap-4 w-full mt-4">
          <Button 
            onClick={onCancel}
            className="flex-1 h-16 text-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl"
          >
            NO, GO BACK
          </Button>
          <Button 
            onClick={onConfirm}
            className="flex-1 h-16 text-xl font-bold bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-[0_0_20px_rgba(220,38,38,0.3)]"
          >
            YES, CANCEL
          </Button>
        </div>
      </div>
    </div>
  );
}
