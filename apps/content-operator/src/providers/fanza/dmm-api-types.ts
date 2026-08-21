export type DmmOutputFormat = "json" | "xml";

export interface DmmNamedEntity {
  id?: number | string;
  name?: string;
  ruby?: string;
}

export interface DmmReview {
  count?: number | string;
  average?: number | string;
}

export interface DmmDelivery {
  type?: string;
  price?: string;
  list_price?: string;
}

export interface DmmPrices {
  price?: string;
  list_price?: string;
  deliveries?: {
    delivery?: DmmDelivery | DmmDelivery[];
  };
}

export interface DmmItemInfo {
  genre?: DmmNamedEntity | DmmNamedEntity[];
  series?: DmmNamedEntity | DmmNamedEntity[];
  maker?: DmmNamedEntity | DmmNamedEntity[];
  actress?: DmmNamedEntity | DmmNamedEntity[];
  director?: DmmNamedEntity | DmmNamedEntity[];
  label?: DmmNamedEntity | DmmNamedEntity[];
  author?: DmmNamedEntity | DmmNamedEntity[];
  actor?: DmmNamedEntity | DmmNamedEntity[];
}

export interface DmmItem {
  service_code?: string;
  service_name?: string;
  floor_code?: string;
  floor_name?: string;
  category_name?: string;
  content_id?: string;
  product_id?: string;
  title?: string;
  volume?: string;
  review?: DmmReview;
  URL?: string;
  affiliateURL?: string;
  imageURL?: {
    list?: string;
    small?: string;
    large?: string;
  };
  sampleImageURL?: {
    sample_s?: { image?: string | string[] };
    sample_l?: { image?: string | string[] };
  };
  prices?: DmmPrices;
  date?: string;
  iteminfo?: DmmItemInfo;
  campaign?: unknown;
  [key: string]: unknown;
}

export interface DmmItemListResult {
  status?: number | string;
  result_count?: number | string;
  total_count?: number | string;
  first_position?: number | string;
  items?: DmmItem[];
}

export interface DmmItemListResponse {
  request?: unknown;
  result?: DmmItemListResult;
}

export interface DmmFloor {
  id?: string;
  name?: string;
  code?: string;
}

export interface DmmService {
  name?: string;
  code?: string;
  floor?: DmmFloor[];
}

export interface DmmSite {
  name?: string;
  code?: string;
  service?: DmmService[];
}

export interface DmmFloorListResult {
  site?: DmmSite[];
}

export interface DmmFloorListResponse {
  request?: unknown;
  result?: DmmFloorListResult;
}

export interface DmmSearchListResult {
  status?: number | string;
  result_count?: number | string;
  total_count?: number | string;
  first_position?: number | string;
  actress?: DmmNamedEntity[];
  genre?: DmmNamedEntity[];
  maker?: DmmNamedEntity[];
  [key: string]: unknown;
}

export interface DmmSearchListResponse {
  request?: unknown;
  result?: DmmSearchListResult;
}

export interface DmmItemListParams {
  site?: string;
  service?: string;
  floor?: string;
  hits?: number;
  offset?: number;
  sort?: string;
  keyword?: string;
  cid?: string;
  gteDate?: string;
  lteDate?: string;
  article?: string;
  articleId?: string;
}

export interface DmmSearchParams {
  floor?: string;
  hits?: number;
  offset?: number;
  keyword?: string;
  initial?: string;
  bust?: string;
  waist?: string;
  hip?: string;
  height?: string;
  birthday?: string;
  sort?: string;
}
