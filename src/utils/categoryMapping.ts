export const getDisplayCategory = (originalCategory: string) => {
  switch (originalCategory) {
    case 'Bollywood Movie':
    case 'South Indian Movie':
      return 'Bollywood';
    case 'Hollywood Movie':
      return 'Hollywood';
    case 'Web Series':
    case 'Anime Series':
    case 'Anime Movie':
    case 'Anime':
      return 'Series';
    default:
      return 'Bollywood';
  }
};
