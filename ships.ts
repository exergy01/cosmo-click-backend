// ������ ��஢� ⨯�
export interface Ship {
  id: string;
  playerId: string;
  shipClass: ShipClass;
  shipModel: string;
  customName?: string;
  level: number;
  experience: number;
  condition: number; // 0-100
����� �뢮�� ������ �� �࠭ (ECHO) ����祭.
  // ���⮬�����
  paintJob: string;
  customSkinId?: string;
  decals: Decal[];
����� �뢮�� ������ �� �࠭ (ECHO) ����祭.
  // ����
  fleetPosition?: number;
  isFlagship: boolean;
����� �뢮�� ������ �� �࠭ (ECHO) ����祭.
  // ���㫨
  modules: ShipModule[];
����� �뢮�� ������ �� �࠭ (ECHO) ����祭.
  // ����⨪�
  battlesFought: number;
  victories: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
}

