export interface Search {
  id: number
  user_query: string
  title: string
  content: string
  timestamp: string
}

export type SearchInsert = Omit<Search, 'id' | 'timestamp'> 