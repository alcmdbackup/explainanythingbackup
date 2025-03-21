export interface Search {
  id: number
  user_query: string
  response: string
  timestamp: string
}

export type SearchInsert = Omit<Search, 'id' | 'timestamp'> 