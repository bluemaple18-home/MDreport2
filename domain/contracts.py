from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FieldSpec:
    name: str
    field_type: str
    nullable: bool
    source_level: str
    default: object


class FieldContract:
    def __init__(self, fields: list[FieldSpec]) -> None:
        self.fields = fields
        self.by_name = {f.name: f for f in fields}

    @classmethod
    def load(cls, path: Path) -> "FieldContract":
        payload = json.loads(path.read_text(encoding="utf-8"))
        fields_raw = payload.get("fields")
        if not isinstance(fields_raw, list):
            raise ValueError("fields contract 格式錯誤：缺少 fields 陣列")
        fields: list[FieldSpec] = []
        for row in fields_raw:
            if not isinstance(row, dict):
                raise ValueError("fields contract 格式錯誤：fields item 必須是 object")
            fields.append(
                FieldSpec(
                    name=str(row.get("name", "")),
                    field_type=str(row.get("type", "")),
                    nullable=bool(row.get("nullable", False)),
                    source_level=str(row.get("source_level", "")),
                    default=row.get("default"),
                )
            )
        if not fields:
            raise ValueError("fields contract 不可為空")
        return cls(fields)

    @property
    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]

    @property
    def manual_fields(self) -> set[str]:
        return {f.name for f in self.fields if f.source_level == "manual"}

    def _validate_scalar(self, spec: FieldSpec, value: object) -> None:
        if value is None:
            if spec.nullable:
                return
            raise ValueError(f"欄位不可為 null: {spec.name}")
        if spec.field_type in {"text", "datetime"}:
            if not isinstance(value, str):
                raise ValueError(f"欄位型別錯誤: {spec.name} 預期 string")
            return
        if spec.field_type == "real":
            if isinstance(value, bool):
                raise ValueError(f"欄位型別錯誤: {spec.name} 預期 number")
            if not isinstance(value, (int, float)):
                raise ValueError(f"欄位型別錯誤: {spec.name} 預期 number")
            return
        raise ValueError(f"未知欄位型別: {spec.name}:{spec.field_type}")

    def validate_and_normalize_save_rows(self, rows: list[dict]) -> list[dict]:
        expected = set(self.by_name.keys())
        normalized_rows: list[dict] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(f"第 {idx} 列不是 object")
            row_keys = set(row.keys())
            unknown = sorted(row_keys - expected)
            if unknown:
                raise ValueError(f"第 {idx} 列含未知欄位: {unknown}")

            normalized: dict[str, object] = {}
            for field in self.fields:
                if field.name in row:
                    value = row.get(field.name)
                    if value is None and not field.nullable:
                        value = field.default
                else:
                    value = field.default
                self._validate_scalar(field, value)
                normalized[field.name] = value
            normalized_rows.append(normalized)
        return normalized_rows

    def validate_modify_updates(self, updates: list[dict]) -> None:
        for idx, item in enumerate(updates):
            if not isinstance(item, dict):
                raise ValueError(f"第 {idx} 個更新不是 object")
            column = str(item.get("column", ""))
            if column not in self.by_name:
                raise ValueError(f"第 {idx} 個更新欄位不在契約中: {column}")
            spec = self.by_name[column]
            if spec.name not in self.manual_fields:
                raise ValueError(f"第 {idx} 個更新欄位非 manual: {column}")
            self._validate_scalar(spec, item.get("value"))


@dataclass(frozen=True)
class RunLogTraceFields:
    source_db_hash: str
    canonical_token: str
    template_version: str
    rule_version: str
    artifact_checksum: str
