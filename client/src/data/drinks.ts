import type { Drink } from '../store/general-store.ts';

export const drinks: Drink[] = [
  // Shots
  { 
    id: '1', 
    name: 'Vodka Shot', 
    category: 'Shots', 
    price: 5, 
    strength: 3,
    image: 'https://images.unsplash.com/photo-1563223771-6f72971d422c?auto=format&fit=crop&q=80&w=400'
  },
  { 
    id: '2', 
    name: 'Gin Shot', 
    category: 'Shots', 
    price: 5, 
    strength: 3,
    image: 'https://images.unsplash.com/photo-1550985543-f47f38aee65d?auto=format&fit=crop&q=80&w=400'
  },

  // Mixes
  { 
    id: '3', 
    name: 'Gin & Tonic', 
    category: 'Mixes', 
    price: 8, 
    strength: 2,
    image: 'https://images.unsplash.com/photo-1598679253544-2c97992403ea?auto=format&fit=crop&q=80&w=400'
  },
  { 
    id: '4', 
    name: 'Vodka Tonic', 
    category: 'Mixes', 
    price: 8, 
    strength: 2,
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400'
  },

  // Energy Mixes
  { 
    id: '5', 
    name: 'Vodka Energy', 
    category: 'Energy Mixes', 
    price: 9, 
    strength: 3,
    image: 'https://images.unsplash.com/photo-1629205696429-d588161d9e3e?auto=format&fit=crop&q=80&w=400'
  },
  { 
    id: '6', 
    name: 'Gin Energy', 
    category: 'Energy Mixes', 
    price: 9, 
    strength: 3,
    image: 'https://images.unsplash.com/photo-1575517111839-3a3843ee7f5d?auto=format&fit=crop&q=80&w=400'
  },

  // Soft Drinks
  { 
    id: '7', 
    name: 'Energy Drink', 
    category: 'Soft Drinks', 
    price: 4, 
    strength: 1,
    image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=400'
  },
  { 
    id: '8', 
    name: 'Tonic Water', 
    category: 'Soft Drinks', 
    price: 3, 
    strength: 1,
    image: 'https://images.unsplash.com/photo-1598679253544-2c97992403ea?auto=format&fit=crop&q=80&w=400'
  },
];

export const categories = ['All', 'Shots', 'Mixes', 'Energy Mixes', 'Soft Drinks'];
