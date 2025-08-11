// Базовые игровые типы
export interface Ship {
  id: string;
  playerId: string;
  shipClass: ShipClass;
  shipModel: string;
  customName?: string;
  level: number;
  experience: number;
  condition: number; // 0-100
Режим вывода команд на экран (ECHO) включен.
  // Кастомизация
  paintJob: string;
  customSkinId?: string;
  decals: Decal[];
Режим вывода команд на экран (ECHO) включен.
  // Флот
  fleetPosition?: number;
  isFlagship: boolean;
Режим вывода команд на экран (ECHO) включен.
  // Модули
  modules: ShipModule[];
Режим вывода команд на экран (ECHO) включен.
  // Статистика
  battlesFought: number;
  victories: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
}

