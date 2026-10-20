export interface Photo {
  id: string;
  url: string;
  width?: number;
  height?: number;
  title: string;
  description: string;
  alt: string;
  tags: string[];
  available: boolean;
  originalUrl?: string;
  date?: string;
  location?: string;
}

export interface WeddingSeries {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  cover: string;
  description: string;
  photos: Photo[];
}
