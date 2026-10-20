
export enum AlbumType {
  FAMILY = 'FAMILY',
  BABY = 'BABY',
  GALLERY = 'GALLERY',
  WEDDING = 'WEDDING',
  TRAVEL = 'TRAVEL',
}

export interface ExifInfo {
  device?: string;
  params?: string;
  iso?: string;
}

export type MediaType = 'image' | 'video';

export interface Photo {
  id: string;
  url: string[]; 
  width?: number;
  height?: number;
  title: string;
  date: string;
  description: string; 
  tags: string[];
  location?: string;
  photographer?: string; 
  albumType: AlbumType;
  mediaType?: MediaType; 
  poster?: string; 
  exif?: ExifInfo; 
}

export interface WeddingSeries {
  id: string;
  title: string;
  subtitle: string;
  cover: string; 
  date: string;
  photographer: string;
  description: string;
  photos: Photo[];
}

export interface TravelTrip {
  id: string;
  country: string; 
  place: string;   
  title: string;   
  date: string;
  cover: string;
  description: string;
  photos: Photo[];
}

export interface TimelineEvent {
  id: string;
  date: string;
  age?: string;
  title: string;
  description: string;
  photos: Photo[];
}

export interface ChildTimeline {
  name: string;
  nickname: string;
  birthday: string;
  avatar?: string;
  gender: 'boy' | 'girl';
  events: TimelineEvent[];
}

export interface Essay {
  id: string;
  content: string;
  date: string;
  from?: string;
  location?: string | string[]; 
  images?: string[];
  video?: string[];
  link?: string;
}

export interface Letter {
  id: string;
  title: string;
  content: string;
  date: string;
  from: string;
  to: string;
  tags?: string[];
  cover?: string;
}

export type NavItem = {
  label: string;
  path: string;
};
