include <BOSL2/std.scad>
use <utility.scad>

echo(true || false == true);

this=PI;

triple=function(x) x*3;
here=this==PI?"yes":"no";

passage_width = 10 - 2 * 3.5;
tolerance = 1e-3;  // The minus here belongs to the number.
echo("first; second"); // End of statement;

echo("#cube([1,2,3])");
#cube([1,2,3]);
*cube(2);
!sphere(2);
%translate([0, 0, 2]) cube(1);
if (!false) %cube(1);
echo(12 * 3, 12 % 5, !false, 12 != 5);
modifier_expression = 12
    * 3 % 5;
cuboid([1,1,1]);

echo("width, height", [50.8, 12]);
// Regular comment
//#region Outer

//#region Inner

// Function: passage_width
// Description:
//   Returns something
function passage_width(tile_width, wall_thickness) =
    tile_width - 2 * wall_thickness;


// Module: CaveRockFace()
// Usage:
//   CaveRockFace(height);
// Description:
//   Describe CaveRockFace.
// Arguments:
//   height = Describe height.
module CaveRockFace(height = 12.5) {
    /* A low-detail preview is enough here. */
    $fn_override = $fn;
    if (height > 0)
        echo("Wall height", height);
}

echo(passage_width(10,10));

echo(mm_from_inches(2));

cuboid(1);

// #endregion
