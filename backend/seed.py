"""Small, realistic scenario catalog for an offline demo or hackathon floor."""

try:  # Support both package imports and ``uvicorn main:app`` from this folder.
    from .models import Scenario
except ImportError:  # pragma: no cover - only used by the direct uvicorn entrypoint.
    from models import Scenario  # type: ignore[no-redef]


SCENARIOS: list[Scenario] = [
    Scenario(
        id="cnc_press_breakdown",
        name="CNC press line breakdown",
        category="industrial",
        description=(
            "A hydraulic stamping press in a Delhi-NCR auto-components plant has "
            "stopped mid-run; the cell needs isolation before maintenance inspection."
        ),
        criticality="critical",
        tags=["maintenance", "hydraulic", "production", "lockout-tagout"],
        sample_reports=[
            "Press-07 Bay 3 ruk gaya hai, hydraulic alarm aa raha hai aur oil mist dikh rahi hai. Koi injury nahi, line down hai.",
            "Machine 04 ka motor overheat ho raha hai, production ruk gaya hai. Maintenance ko LOTO ke liye bulao.",
            "Press-07 stopped with a hydraulic alarm and oil mist near Bay 3; no injury reported and 42 minutes of downtime.",
        ],
    ),
    Scenario(
        id="water_main_break",
        name="Municipal water main break",
        category="civic",
        description=(
            "A water main failure affects traffic, homes, and public health response "
            "in a neighborhood while a crew prepares an isolation and repair."
        ),
        criticality="high",
        tags=["public-works", "water", "traffic", "resident-notice"],
        sample_reports=[
            "School ke paas Sector 5 road par main leak hai, do lanes mein paani bhar gaya; traffic control bhejo.",
            "Large water leak at 5th and Pine has flooded two lanes; 18 homes may lose service.",
        ],
    ),
    Scenario(
        id="cold_chain_dispatch",
        name="Cold-chain dispatch interruption",
        category="logistics",
        description=(
            "A refrigerated distribution route is delayed, requiring a temperature "
            "check and a controlled reroute before product quality is compromised."
        ),
        criticality="high",
        tags=["warehouse", "reefer", "food-safety", "reroute"],
        sample_reports=[
            "Reefer truck 12 ninety minutes late hai, trailer 9C dikha raha hai; 24 pallets ko hold karke temperature check karo.",
            "Freezer dock sensor failed; hold 24 pallets, inspect the logger, and arrange another vehicle.",
        ],
    ),
]


SCENARIO_BY_ID = {scenario.id: scenario for scenario in SCENARIOS}
