import { Outlet } from 'react-router-dom';
import { DrinkModal } from '@/components/shared/drink-modal.tsx';

export const Layout = () => {
  return (
    <div className='w-full h-screen bg-black text-white overflow-hidden select-none font-sans'>
      <Outlet />
      <DrinkModal />
    </div>
  );
};
