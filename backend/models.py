from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ElementBase(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=40)
    positionMm: float = Field(ge=0, le=600)

    @field_validator("id", "name")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("名称或编号不能为空。")
        return value


class Laser(ElementBase):
    kind: Literal["laser"]
    wavelengthNm: float = Field(ge=380, le=1100)
    waistMm: float = Field(ge=0.01, le=20)


class Lens(ElementBase):
    kind: Literal["lens"]
    focalLengthMm: float = Field(ge=-5000, le=5000)
    diameterMm: float = Field(ge=1, le=100)

    @field_validator("focalLengthMm")
    @classmethod
    def nonzero_focal_length(cls, value: float) -> float:
        if abs(value) < 1:
            raise ValueError("焦距绝对值必须至少为1 mm。")
        return value


class Screen(ElementBase):
    kind: Literal["screen"]
    sizeMm: float = Field(ge=5, le=100)


Element = Annotated[Laser | Lens | Screen, Field(discriminator="kind")]


class Experiment(StrictModel):
    schemaVersion: Literal[1]
    name: str = Field(min_length=1, max_length=80)
    railLengthMm: Literal[600]
    elements: list[Element] = Field(max_length=50)

    @model_validator(mode="after")
    def validate_ids(self):
        if not self.name.strip():
            raise ValueError("实验名称不能为空。")
        ids = [item.id for item in self.elements]
        if len(ids) != len(set(ids)):
            raise ValueError("元件编号重复。")
        if sum(isinstance(item, Laser) for item in self.elements) > 1:
            raise ValueError("只支持一个光源。")
        return self


class SimulationRequest(StrictModel):
    revision: int = Field(ge=0, le=2_147_483_647)
    experiment: Experiment
