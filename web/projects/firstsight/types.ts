export interface Photo {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
  description: string;
  alt: string;
  tags: string[];
}

export interface WeddingSeries {
  id: string;
  title: string;
  subtitle: string;
  cover: string;
  description: string;
  photos: Photo[];
}
