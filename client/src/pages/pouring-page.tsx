import { useNavigate } from 'react-router-dom';
import { generalStore } from '@/store/general-store.ts';
import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';

export function PouringPage() {
  const navigate = useNavigate();
  const { cart } = generalStore();
  const [progress, setProgress] = useState(0);
  const [currentDrinkIndex, setCurrentDrinkIndex] = useState(0);

  useEffect(() => {
    if (cart.length === 0) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (currentDrinkIndex < cart.length - 1) {
            setCurrentDrinkIndex((i) => i + 1);
            return 0;
          } else {
            clearInterval(interval);
            setTimeout(() => navigate('/completion'), 1000);
            return 100;
          }
        }
        return prev + 2; // Adjust speed here
      });
    }, 50);

    return () => clearInterval(interval);
  }, [cart.length, currentDrinkIndex, navigate]);

  const currentDrink = cart[currentDrinkIndex];

  return (
    <div className='h-full w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-12'>
      <div className='w-full max-w-2xl flex flex-col items-center gap-12'>
        {/* Animated Cup */}
        <div className='relative w-64 h-80 border-4 border-white/20 border-t-0 rounded-b-3xl overflow-hidden bg-zinc-900/50 backdrop-blur-sm'>
          <div
            className='absolute bottom-0 left-0 right-0 bg-purple-500 shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all duration-100 ease-linear'
            style={{ height: `${progress}%` }}
          >
            <div className='absolute top-0 left-0 right-0 h-4 bg-purple-400 opacity-50 animate-pulse' />

            {/* Bubbles */}
            <div className='absolute inset-0 w-full h-full'>
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className='absolute bottom-0 w-2 h-2 bg-white/30 rounded-full animate-bounce'
                  style={{
                    left: `${Math.random() * 100}%`,
                    animationDuration: `${1 + Math.random()}s`,
                    animationDelay: `${Math.random()}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className='text-center space-y-4'>
          <h2 className='text-3xl text-zinc-400'>Now Pouring</h2>
          <h1 className='text-5xl font-bold text-white animate-pulse'>{currentDrink?.name}</h1>
          {currentDrink?.isDouble && (
            <span className='inline-block px-4 py-2 bg-purple-500/20 text-purple-400 text-xl font-bold rounded-full border border-purple-500/30'>
              DOUBLE
            </span>
          )}
        </div>

        <div className='w-full space-y-4'>
          <Progress value={progress} className='h-4 bg-zinc-800' />
          <div className='flex justify-between text-xl text-zinc-500 font-mono'>
            <span>{Math.round(progress)}%</span>
            <span>
              Drink {currentDrinkIndex + 1} of {cart.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
