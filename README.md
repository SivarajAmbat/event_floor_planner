# Basecamp Event Floor Planner

A web-based floor planning tool designed to help plan and optimize the seating and floor layout for Basecamp events accommodating up to 500 people.

The planner helps event organizers experiment with table arrangements, seating capacity, aisle space, and overall floor utilization before setting up the physical event space.

## Overview

Planning a large event requires balancing several competing requirements:
- Seating capacity
- Table and chair placement
- Comfortable spacing between attendees
- Aisle and circulation space
- Available floor area
- Efficient use of the venue
- Avoiding overly crowded layouts

The Basecamp Event Floor Planner provides a visual way to design and evaluate these layouts. It is intended to answer questions such as:
- How many people can we accommodate in this space?
- How many tables and chairs can fit?
- Where should tables be positioned?
- Is there enough aisle space for people to move comfortably?
- Is the proposed layout too crowded?

## Key Features
- Floor Layout Planning
- Create and arrange a floor plan representing the Basecamp event space.

The planner allows you to experiment with different table configurations and positions to find an arrangement that makes effective use of the available floor area.

## Seating Capacity

The planner calculates seating capacity based on the configured table and chair arrangements.

The goal is to help create layouts capable of accommodating up to 500 attendees while maintaining reasonable spacing.

## Table and Chair Spacing

The planner uses configurable spacing rules for chairs and tables.

For example, the current configuration includes:

- Setting	Value	Description
- Chair footprint	1.4 ft × 1.4 ft	Approximate space occupied by a chair
- Table-to-chair gap	0.1 ft	Clearance between table edge and chair
- Chair pitch	1.5 ft	Minimum chair center-to-center spacing
- Tight aisle threshold	3 ft	Aisles below this width are considered very tight
- Tight floor coverage	90%	High overall floor utilization threshold

These values can be adjusted as the planning requirements evolve.

## Aisle and Circulation Analysis

The planner considers aisle space when evaluating a layout.

Layouts with very narrow aisles can be identified as tight, helping organizers avoid configurations that technically fit but may be uncomfortable or difficult to navigate.

## Floor Utilization

The planner evaluates how much of the usable floor area is occupied by tables, chairs, groups, and circulation areas.

A layout that uses approximately 90% or more of the usable floor area is considered very tight.

## Visual Planning

The floor plan provides a visual representation of the proposed arrangement, making it easier to understand how the venue will look before physically setting up the event.

## Target Capacity

The primary goal of this project is to help design a Basecamp event layout capable of accommodating 500 people

The actual achievable capacity depends on:

- Available floor dimensions
- Table dimensions
- Table configuration
- Number of seats per table
- Required aisles
- Entrances and exits
- Stage or presentation areas
- Equipment and service areas
- Required safety clearances

The planner should therefore be treated as a planning and visualization tool, rather than a substitute for venue safety requirements or official occupancy limits.

## Layout Considerations

When designing a layout, consider the following:

### Seating

Provide sufficient personal space for each attendee and avoid unnecessarily tight chair arrangements.

### Aisles

Maintain adequate circulation paths between groups of tables.

In particular, avoid layouts where aisles fall below the configured tight-aisle threshold.

### Entrances and Exits

Keep entrances, exits, emergency routes, and other required access paths clear.

### Accessibility

The final physical layout should provide appropriate accessible routes and spaces in accordance with the requirements applicable to the venue.

### Emergency Access

The floor planner should not be used to reduce or obstruct required emergency access, fire exits, or evacuation routes.


## Recommended Workflow

For an event targeting 500 attendees:

- Define the available floor area
- Reserve fixed areas such as stages, entrances, exits, service areas, and equipment
- Determine the desired table configuration
- Place the tables
- Add seating
- Evaluate aisle widths
- Check overall floor utilization
- Verify the target capacity
- Review the final layout for accessibility and safety
- Use the resulting plan as the basis for the physical event setup

## Important Notes

1. The planner provides a layout estimation and planning aid.
2. The calculated capacity should not be treated as an official occupancy determination.
3. Before using a layout for an actual event, verify it against:

- Venue occupancy limits
- Local fire and building regulations
- Emergency exit requirements
- Accessibility requirements
- Fire safety requirements
- Venue-specific rules
- Event safety policies

Where there is a conflict between the planner and an official requirement, the official requirement takes precedence.

## Goal

The ultimate goal of the Basecamp Event Floor Planner is to make large-event setup easier by allowing organizers to design, test, visualize, and optimize a 500-person floor layout before the event begins.

A good layout should not simply maximize the number of people that fit into the room. It should provide a practical balance between capacity, comfort, circulation, accessibility, and safety.

Developed by Sivaraj for **Global Learning & Talent Development Team**
