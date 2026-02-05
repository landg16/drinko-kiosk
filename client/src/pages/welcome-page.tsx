import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-zinc-950 text-white relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-purple-900/20 via-zinc-950 to-zinc-950" />
      
      <div className="z-10 flex flex-col items-center gap-12 animate-in fade-in zoom-in duration-500">
        <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-white to-zinc-400 drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
          DRINKO
        </h1>
        
        <Button 
          size="lg"
          className="h-24 px-12 text-3xl font-bold rounded-full bg-purple-600 hover:bg-purple-500 shadow-[0_0_30px_rgba(147,51,234,0.5)] border-2 border-purple-400/50 transition-all hover:scale-105 active:scale-95"
          onClick={() => navigate('/menu')}
        >
          START ORDER
        </Button>
        
        <p className="text-zinc-500 text-xl animate-pulse">Tap to begin</p>
      </div>
    </div>
  )
}
