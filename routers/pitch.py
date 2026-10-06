"""Who "I" am in every AI message, edited from the extension's toolbar popup."""
from __future__ import annotations

from fastapi import APIRouter

from models import PitchConfig
from routers.common import failure
from services.ai_service import get_pitch_config, save_pitch_config

router = APIRouter()


@router.get("/pitch-config")
async def read_pitch_config():
    return get_pitch_config()


@router.post("/pitch-config")
async def write_pitch_config(data: PitchConfig):
    try:
        return save_pitch_config(data.model_dump(exclude_none=True))
    except Exception as e:
        raise failure(e, "Saving the pitch")
