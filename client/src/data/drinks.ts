import type { Drink } from '../store/general-store.ts';

export const drinks: Drink[] = [
  // Shots
  { id: '1', name: 'Vodka Shot', category: 'Shots', price: 5, strength: 3 },
  { id: '2', name: 'Gin Shot', category: 'Shots', price: 5, strength: 3 },

  // Mixes
  { id: '3', name: 'Gin & Tonic', category: 'Mixes', price: 8, strength: 2 },
  { id: '4', name: 'Vodka Tonic', category: 'Mixes', price: 8, strength: 2 },

  // Energy Mixes
  { id: '5', name: 'Vodka Energy', category: 'Energy Mixes', price: 9, strength: 3 },
  { id: '6', name: 'Gin Energy', category: 'Energy Mixes', price: 9, strength: 3 },

  // Soft Drinks
  { id: '7', name: 'Energy Drink', category: 'Soft Drinks', price: 4, strength: 1 },
  { id: '8', name: 'Tonic Water', category: 'Soft Drinks', price: 3, strength: 1 },
];

export const categories = ['Shots', 'Mixes', 'Energy Mixes', 'Soft Drinks'];
