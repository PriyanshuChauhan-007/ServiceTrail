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
            "A hydraulic stamping press has stopped mid-run, putting a production "
            "cell and nearby operators at risk until energy is isolated."
        ),
        criticality="critical",
        tags=["maintenance", "hydraulic", "production", "lockout-tagout"],
        sample_reports=[
            "Press-07 stopped with a hydraulic alarm and oil mist near Bay 3. No injury reported; line is down.",
            "CNC-204 spindle is vibrating and making a sharp noise. Technician requests an immediate inspection.",
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
            "Large water leak reported at 5th and Pine; two lanes are flooded and 18 homes may lose service.",
            "Crew sees a burst pipe by the school. Close the road and notify residents before shutting the valve.",
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
            "Reefer truck 12 is 90 minutes late and the trailer reads 9C; 24 pallets need a temperature check.",
            "Freezer dock sensor failed. Hold the shipment, inspect the logger, and find another vehicle.",
        ],
    ),
]


SCENARIO_BY_ID = {scenario.id: scenario for scenario in SCENARIOS}
